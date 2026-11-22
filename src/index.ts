import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { createUpdaterAdapter } from "./adapters/createUpdaterAdapter.js";
import type { UpdaterAdapter } from "./adapters/electronUpdaterAdapter.js";
import { BarrelConfigError } from "./errors.js";
import type { HostControl } from "./hostControl.js";
import { startHostControl } from "./hostControl.js";
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
import { verifyAndParsePolicy } from "./protocol/policy.js";
import { quitIfSquirrelStartupEvent } from "./squirrelStartup.js";
import type { AdapterState, InitConfig, Policy, UpdateFailure } from "./types.js";
import {
  DEFAULT_HOLD_CACHE_MAX_AGE_MS,
  DEFAULT_INTERVAL_MS,
  MAX_HOLD_CACHE_MAX_AGE_MS,
  startCadence,
} from "./cadence.js";

let initialized = false;
let lastKnownPolicy: Policy | undefined;
let debugLog: ((message: string) => void) | undefined;
let updaterAdapter: UpdaterAdapter | undefined;
let hostControl: HostControl | undefined;
let pendingStateChangeListeners: ((state: AdapterState) => void)[] = [];

/**
 * Resolves what the previous session's apply attempt, if any, expected
 * to be running by now against what's actually running, then clears the
 * marker either way so this only ever fires once per attempt.
 */
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

/**
 * The only required call. Silent until this runs, throws synchronously only
 * for invalid config, and is a silent no-op on a second call -- every later
 * failure fails open instead of throwing.
 */
export function init(config: InitConfig): void {
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

  if (config.holdCacheMaxAge !== undefined && config.holdCacheMaxAge > MAX_HOLD_CACHE_MAX_AGE_MS) {
    throw new BarrelConfigError("Barrel: `holdCacheMaxAge` must not exceed 7 days.");
  }

  initialized = true;
  debugLog = config.debug
    ? (message: string) => console.debug(`[barrel-kit] ${message}`)
    : undefined;

  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const checkInIntervalMs = config.checkInIntervalMs ?? DEFAULT_INTERVAL_MS;
  const attributes = config.attributes ?? {};
  const channel = config.channel ?? "stable";
  const autoDownload = config.autoDownload ?? true;
  const installationIdPath = join(app.getPath("userData"), "barrel-installation.json");
  const bufferedFactsPath = join(app.getPath("userData"), "barrel-buffered-facts.json");
  const trustedKeyPath = join(app.getPath("userData"), "barrel-trusted-key.json");
  const versionExpectationPath = join(app.getPath("userData"), "barrel-version-expectation.json");

  void Promise.all([
    getOrCreateInstallationId(installationIdPath),
    createUpdaterAdapter(),
    configureBufferedFacts(bufferedFactsPath),
    getOrCreateTrustedKey(trustedKeyPath, PUBLIC_ED25519_KEY_PEM),
    configureVersionExpectation(versionExpectationPath),
  ]).then(
    ([installationId, adapter, _bufferedFactsConfigured, _trustedKeyReady, expectedVersion]) => {
      updaterAdapter = adapter;
      checkVersionExpectation(expectedVersion);
      if (config.updateFeedURL) adapter.setFeedURL(config.updateFeedURL);
      for (const listener of pendingStateChangeListeners) adapter.onStateChange(listener);
      pendingStateChangeListeners = [];
      const connection = { baseUrl, credential: config.credential, installationId };

      hostControl = startHostControl({
        connection,
        autoDownload,
        adapter,
        getTrustedKeyPem: () => getTrustedKey() ?? PUBLIC_ED25519_KEY_PEM,
        recordVersionExpectation: setExpectedVersion,
        clearVersionExpectation: clearExpectedVersion,
        log: debugLog,
      });
      startCadence({
        connection,
        retryInstallationPersistence: retryInstallationIdPersistence,
        checkInIntervalMs,
        sdkVersion: __SDK_VERSION__,
        channel,
        attributes,
        log: debugLog,
        getAdapterState: () => adapter.getAdapterState(),
        getBufferedFacts,
        clearBufferedFacts,
        checkForUpdates: () => adapter.checkForUpdates(),
        getPolicy: () => lastKnownPolicy,
        holdCacheMaxAge: config.holdCacheMaxAge ?? DEFAULT_HOLD_CACHE_MAX_AGE_MS,
        onPolicyResponse: (response) => {
          if (!response) return; // fail open — keep the last-known Policy
          const parsed = verifyAndParsePolicy(response, getTrustedKey() ?? PUBLIC_ED25519_KEY_PEM);
          if (parsed) lastKnownPolicy = parsed;
          debugLog?.(parsed ? "policy: verified and updated" : "policy: verification failed");
          applyKeyRotationIfPresent(response); // takes effect from the next check-in on
        },
      });
    },
  );
}

/** Synchronous getter. `undefined` before the first successful check-in — never a synthesized default. */
export function getPolicy(): Policy | undefined {
  return lastKnownPolicy;
}

/**
 * Synchronous getter. Cached from the adapter's own last-observed failure,
 * or -- if the process crashed or restarted before the next check-in flushed
 * it -- the most recent buffered `updateError` fact. `undefined` only if
 * neither source has one.
 */
export function getLastUpdateError(): UpdateFailure | undefined {
  const adapterError = updaterAdapter?.getLastUpdateError();
  if (adapterError) return adapterError;

  const buffered = getLastBufferedUpdateError();
  if (!buffered) return undefined;

  return { ...buffered, title: resolveFailureTitle(buffered.failureMode) };
}

/** Synchronous getter. `undefined` before `init()` has resolved its async setup. */
export function getAdapterState(): AdapterState | undefined {
  return updaterAdapter?.getAdapterState();
}

/**
 * Fires on every local adapter-state transition, in addition to -- never
 * instead of -- `getAdapterState()`'s own polling. Register once, at
 * startup; listeners are never removed.
 */
export function onStateChange(listener: (state: AdapterState) => void): void {
  if (updaterAdapter) {
    updaterAdapter.onStateChange(listener);
  } else {
    // Queued until init()'s async setup creates the adapter.
    pendingStateChangeListeners.push(listener);
  }
}

/**
 * Triggers a download when `autoDownload: false` leaves nothing else that
 * ever would. A no-op, not a throw, before `init()` has resolved or before
 * an update is actually `available`.
 */
export function downloadUpdate(): void {
  hostControl?.downloadUpdate();
}

/**
 * Host-triggered earlier apply, ahead of the natural-quit default. A no-op,
 * not a throw, before `init()` has resolved or before anything has actually
 * downloaded -- there's nothing yet to apply.
 */
export function applyUpdate(): void {
  hostControl?.applyUpdate();
}

export type {
  AdapterState,
  InitConfig,
  Policy,
  UpdateFailure,
  UpdateFailureMode,
} from "./types.js";
