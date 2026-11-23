import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { createUpdaterAdapter } from "./adapters/createUpdaterAdapter.js";
import { createListenerSet } from "./adapters/listenerSet.js";
import type { UpdaterAdapter } from "./adapters/updaterAdapter.js";
import { ActionError } from "./models/actionError.js";
import { BarrelConfigError } from "../errors.js";
import { startHostControl, type HostControl } from "./hostControl.js";
import { DEFAULT_BASE_URL, PUBLIC_ED25519_KEY_PEM } from "./keys.js";
import { classifyAndRecordFailure, resolveFailureTitle } from "./errorTaxonomy.js";
import {
  clearBufferedFacts,
  configureBufferedFacts,
  getBufferedFacts,
  getLastBufferedUpdateError,
} from "./persistence/bufferedFacts.js";
import {
  getOrCreateInstallationId,
  retryInstallationIdPersistence,
} from "./persistence/installationId.js";
import {
  applyKeyRotationIfPresent,
  getOrCreateTrustedKey,
  getTrustedKey,
} from "./persistence/keyRotation.js";
import {
  clearExpectedVersion,
  configureVersionExpectation,
  setExpectedVersion,
} from "./persistence/versionExpectation.js";
import { verifyAndParseUpdateEligibility } from "./protocol/updateEligibilityVerification.js";
import { quitIfSquirrelStartupEvent } from "./squirrelStartup.js";
import type { InitConfig } from "../initConfig.js";
import type { Status, Subscription } from "./models/status.js";
import type { UpdateEligibility } from "./models/eligibility.js";
import type { UpdateFailure } from "./models/failure.js";
import type { UpdateState } from "./models/state.js";
import {
  DEFAULT_HOLD_CACHE_MAX_AGE_MS,
  DEFAULT_INTERVAL_MS,
  MAX_HOLD_CACHE_MAX_AGE_MS,
  startCadence,
} from "./cadence.js";

interface RuntimeEnvironment {
  startCadence: typeof startCadence;
  startHostControl: typeof startHostControl;
  configureBufferedFacts: typeof configureBufferedFacts;
}

const nativeEnvironment: RuntimeEnvironment = {
  startCadence,
  startHostControl,
  configureBufferedFacts,
};

/** One SDK runtime per process; persistence stores retain that same lifetime. */
export function createRuntime(environment: RuntimeEnvironment = nativeEnvironment) {
  let initialized = false;
  let lastKnownUpdateEligibility: UpdateEligibility | undefined;
  let debugLog: ((message: string) => void) | undefined;
  let updaterAdapter: UpdaterAdapter | undefined;
  let hostControl: HostControl | undefined;
  const statusListeners = createListenerSet<Status>();

  // Clear the previous apply expectation after checking the running version;
  // each expectation produces at most one failure observation.
  function checkVersionExpectation(expectedVersion: string | undefined): void {
    if (expectedVersion === undefined) return;

    if (expectedVersion !== app.getVersion()) {
      classifyAndRecordFailure(
        "version-check",
        "apply-not-confirmed",
        "install",
        `expected ${expectedVersion}, running ${app.getVersion()}`,
      );
    }
    void clearExpectedVersion();
  }

  // Only caller-fixable configuration throws synchronously. Initialization
  // is process-scoped; subsequent calls leave the running SDK unchanged.
  function init(config: InitConfig): void {
    if (initialized) {
      debugLog?.("init() called again — ignored, the SDK is already running");
      return;
    }

    // init() itself must run this early -- before any window is created --
    // since that's the only way a Squirrel lifecycle event quits in time.
    if (quitIfSquirrelStartupEvent(app, BrowserWindow)) return;

    if (process.type !== "browser") {
      throw new BarrelConfigError("Barrel: init() must run in Electron's main process.");
    }

    if (config.credential.trim().length === 0) {
      throw new BarrelConfigError("Barrel: init() requires a non-empty `credential`.");
    }

    if (
      config.updates?.checkInIntervalMs !== undefined &&
      !Number.isFinite(config.updates?.checkInIntervalMs)
    ) {
      throw new BarrelConfigError("Barrel: `checkInIntervalMs` must be finite.");
    }

    if (
      config.updates?.holdCacheMaxAge !== undefined &&
      config.updates?.holdCacheMaxAge > MAX_HOLD_CACHE_MAX_AGE_MS
    ) {
      throw new BarrelConfigError("Barrel: `holdCacheMaxAge` must not exceed 7 days.");
    }

    initialized = true;
    debugLog = config.debug
      ? (message: string) => console.debug(`[barrel-kit] ${message}`)
      : undefined;

    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const checkInIntervalMs = config.updates?.checkInIntervalMs ?? DEFAULT_INTERVAL_MS;
    const attributes = config.updates?.attributes ?? {};
    const channel = config.updates?.channel ?? "stable";
    const autoDownload = config.updates?.autoDownload ?? true;
    const installationIdPath = join(app.getPath("userData"), "barrel-installation.json");
    const bufferedFactsPath = join(app.getPath("userData"), "barrel-buffered-facts.json");
    const trustedKeyPath = join(app.getPath("userData"), "barrel-trusted-key.json");
    const versionExpectationPath = join(app.getPath("userData"), "barrel-version-expectation.json");

    void Promise.all([
      getOrCreateInstallationId(installationIdPath),
      createUpdaterAdapter(),
      environment.configureBufferedFacts(bufferedFactsPath),
      getOrCreateTrustedKey(trustedKeyPath, PUBLIC_ED25519_KEY_PEM),
      configureVersionExpectation(versionExpectationPath),
    ])
      .then(
        ([
          installationId,
          adapter,
          _bufferedFactsConfigured,
          _trustedKeyReady,
          expectedVersion,
        ]) => {
          updaterAdapter = adapter;
          checkVersionExpectation(expectedVersion);
          if (config.updates?.updateFeedURL) adapter.setFeedURL(config.updates?.updateFeedURL);
          // Permanent forwarding into the one public listener set -- not
          // per-caller queuing; `subscribe()` itself never needs to know
          // whether the adapter exists yet.
          adapter.onStateChange((state) => {
            void statusListeners.notify({ ...getStatus(), state });
          });
          adapter.onUpdateError((failure) => {
            void statusListeners.notify({ ...getStatus(), lastError: failure });
          });
          const connection = { baseUrl, credential: config.credential, installationId };

          hostControl = environment.startHostControl({
            connection,
            autoDownload,
            adapter,
            onEligibility: publishEligibility,
            getTrustedKeyPem: () => getTrustedKey() ?? PUBLIC_ED25519_KEY_PEM,
            recordVersionExpectation: setExpectedVersion,
            clearVersionExpectation: clearExpectedVersion,
            log: debugLog,
          });
          environment.startCadence({
            connection,
            retryInstallationPersistence: retryInstallationIdPersistence,
            checkInIntervalMs,
            sdkVersion: __SDK_VERSION__,
            channel,
            attributes,
            log: debugLog,
            getUpdateState: () => adapter.getUpdateState(),
            subscribeToStateChanges: adapter.onStateChange,
            getBufferedFacts,
            clearBufferedFacts,
            checkForUpdates: () => adapter.checkForUpdates(),
            getUpdateEligibility: () => lastKnownUpdateEligibility,
            holdCacheMaxAge: config.updates?.holdCacheMaxAge ?? DEFAULT_HOLD_CACHE_MAX_AGE_MS,
            onEligibilityResponse: (response) => {
              if (!response) return; // fail open — keep the last-known UpdateEligibility
              const parsed = verifyAndParseUpdateEligibility(
                response,
                getTrustedKey() ?? PUBLIC_ED25519_KEY_PEM,
              );
              if (parsed) {
                publishEligibility(parsed);
              }
              debugLog?.(
                parsed
                  ? "updateEligibility: verified and updated"
                  : "updateEligibility: verification failed",
              );
              applyKeyRotationIfPresent(response); // takes effect from the next check-in on
            },
          });
        },
      )
      .catch(() => {
        debugLog?.("initialization unavailable; reporting remains disabled");
      });
  }

  /** `undefined` before the first successful check-in — never a synthesized default. */
  function getUpdateEligibility(): UpdateEligibility | undefined {
    return lastKnownUpdateEligibility;
  }

  /** Cached from the adapter's own last-observed failure, or -- if the process crashed or
   * restarted before the next check-in flushed it -- the most recent buffered `updateError` fact. `undefined`
   * only if neither source has one. */
  function getLastUpdateError(): UpdateFailure | undefined {
    const adapterError = updaterAdapter?.getLastUpdateError();
    if (adapterError) return adapterError;

    const buffered = getLastBufferedUpdateError();
    if (!buffered) return undefined;

    return { ...buffered, title: resolveFailureTitle(buffered.failureMode) };
  }

  /** `idle` before `init()`'s async setup resolves -- the adapter's own
   * real starting state, not a synthesized stand-in. */
  function getUpdateState(): UpdateState {
    return updaterAdapter?.getUpdateState() ?? { type: "idle" };
  }

  /** The full picture a host app renders in one place. */
  function getStatus(): Status {
    return structuredClone({
      state: getUpdateState(),
      eligibility: getUpdateEligibility(),
      lastError: getLastUpdateError(),
    });
  }

  function publishEligibility(eligibility: UpdateEligibility): void {
    lastKnownUpdateEligibility = eligibility;
    void statusListeners.notify(getStatus());
  }

  /** Delivers the current snapshot immediately and after changes. */
  function subscribe(listener: (status: Status) => void): Subscription {
    const remove = statusListeners.add((status) => listener(structuredClone(status)));

    try {
      void Promise.resolve(listener(getStatus())).catch(() => {
        debugLog?.("status observer failed");
      });
    } catch {
      debugLog?.("status observer failed");
    }

    return { remove };
  }

  async function download(): Promise<void> {
    if (!hostControl) throw new ActionError("notReady");

    await hostControl.downloadUpdate();
  }

  async function apply(): Promise<void> {
    if (!hostControl) throw new ActionError("notReady");

    await hostControl.applyUpdate();
  }

  return { init, getStatus, subscribe, download, apply };
}

export const runtime = createRuntime();
