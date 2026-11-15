import { app } from "electron";
import { join } from "node:path";
import { createUpdaterAdapter } from "./adapters/createUpdaterAdapter.js";
import type { UpdaterAdapter } from "./adapters/electronUpdaterAdapter.js";
import { startCadence } from "./cadence.js";
import { BarrelConfigError } from "./errors.js";
import { getOrCreateInstallationId } from "./installationId.js";
import { DEFAULT_BASE_URL, PUBLIC_ED25519_KEY_PEM } from "./keys.js";
import { verifyAndParsePolicy } from "./policy.js";
import type { InitConfig, Policy, UpdateFailure } from "./types.js";
import { DEFAULT_INTERVAL_MS } from "./cadence.js";

let initialized = false;
let lastKnownPolicy: Policy | undefined;
let debugLog: ((message: string) => void) | undefined;
let updaterAdapter: UpdaterAdapter | undefined;

/**
 * The only required call. Silent until this runs, throws synchronously only
 * for invalid config, and is a silent no-op on a second call — every later
 * failure fails open instead of throwing.
 */
export function init(config: InitConfig): void {
  if (initialized) {
    debugLog?.("init() called again — ignored, the SDK is already running");
    return;
  }

  if (process.type !== "browser") {
    throw new BarrelConfigError("Barrel: init() must run in Electron's main process.");
  }

  if (config.credential.trim().length === 0) {
    throw new BarrelConfigError("Barrel: init() requires a non-empty `credential`.");
  }

  initialized = true;
  debugLog = config.debug
    ? (message: string) => console.debug(`[barrel-kit] ${message}`)
    : undefined;

  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const checkInIntervalMs = config.checkInIntervalMs ?? DEFAULT_INTERVAL_MS;
  const attributes = config.attributes ?? {};
  const installationIdPath = join(app.getPath("userData"), "barrel-installation.json");

  void Promise.all([getOrCreateInstallationId(installationIdPath), createUpdaterAdapter()]).then(
    ([installationId, adapter]) => {
      updaterAdapter = adapter;
      startCadence({
        baseUrl,
        credential: config.credential,
        installationId,
        checkInIntervalMs,
        sdkVersion: __SDK_VERSION__,
        attributes,
        log: debugLog,
        getAdapterState: () => adapter.getAdapterState(),
        checkForUpdates: () => adapter.checkForUpdates(),
        onPolicyResponse: (response) => {
          if (!response) return; // fail open — keep the last-known Policy
          const parsed = verifyAndParsePolicy(response, PUBLIC_ED25519_KEY_PEM);
          if (parsed) lastKnownPolicy = parsed;
          debugLog?.(parsed ? "policy: verified and updated" : "policy: verification failed");
        },
      });
    },
  );
}

/** Synchronous getter. `undefined` before the first successful check-in — never a synthesized default. */
export function getPolicy(): Policy | undefined {
  return lastKnownPolicy;
}

/** Synchronous getter. `undefined` if nothing has failed this session. */
export function getLastUpdateError(): UpdateFailure | undefined {
  return updaterAdapter?.getLastUpdateError();
}

export type {
  AdapterState,
  InitConfig,
  Policy,
  UpdateFailure,
  UpdateFailureMode,
} from "./types.js";
