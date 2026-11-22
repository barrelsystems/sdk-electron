import { app, powerMonitor } from "electron";
import { sendCheckIn } from "./protocol/checkIn.js";
import { collectEnvironment } from "./env.js";
import { computeJitterFraction } from "./jitter.js";
import type { BufferedFact } from "./persistence/bufferedFacts.js";
import type { AdapterState, BackendConnection, CheckInResponse, Policy } from "./types.js";

export const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
export const MIN_INTERVAL_MS = 15 * 60 * 1000;
export const DEFAULT_HOLD_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_HOLD_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CadenceParams {
  connection: BackendConnection;
  checkInIntervalMs: number;
  sdkVersion: string;
  channel: string;
  attributes: Record<string, string>;
  getAdapterState: () => AdapterState;
  getBufferedFacts: () => readonly BufferedFact[];
  /** Called only once ingestion ACKs the check-in that carried `sent` -- never optimistically. */
  clearBufferedFacts: (sent: readonly BufferedFact[]) => void;
  onPolicyResponse: (response: CheckInResponse | undefined) => void;
  checkForUpdates: () => void;
  getPolicy: () => Policy | undefined;
  holdCacheMaxAge: number;
  log?: ((message: string) => void) | undefined;
}

/**
 * `undefined`/`current`/`updateEligible` never hold the check -- only a
 * confirmed `held` Policy within its ceiling (the earlier of `holdCacheMaxAge`
 * and the operator's own `until`) does, so an offline client fails open.
 */
export function policyHoldsTheVendorCheck(
  policy: Policy | undefined,
  holdCacheMaxAge: number,
  now: number,
): boolean {
  if (policy?.type !== "held") return false;
  if (now - Date.parse(policy.issuedAt) > holdCacheMaxAge) return false;
  if (policy.until !== undefined && now > Date.parse(policy.until)) return false;
  return true;
}

/**
 * Checks in on launch, then on a jittered interval, plus on resume-from-sleep
 * and foreground/focus. Overlapping attempts are impossible: a tick that fires
 * while the previous one is still in flight is skipped, not queued.
 */
export interface Cadence {
  ready: Promise<void>;
  checkNow(): Promise<void>;
  stop(): void;
}

export function startCadence(params: CadenceParams): Cadence {
  if (params.checkInIntervalMs < MIN_INTERVAL_MS) {
    params.log?.(
      `cadence: requested interval ${params.checkInIntervalMs}ms is below the ${MIN_INTERVAL_MS}ms floor, clamped`,
    );
  }
  const interval = Math.max(params.checkInIntervalMs, MIN_INTERVAL_MS);
  const jitterFraction = computeJitterFraction(params.connection.installationId);
  const jitteredInterval = Math.round(interval * (1 + jitterFraction));

  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) {
      params.log?.("cadence: tick skipped, a check-in is already in flight");
      return;
    }
    inFlight = true;
    try {
      // The vendor update-feed check piggybacks on this same cadence but
      // MUST NOT run while held -- a Hold gates the check itself, not just
      // the download/apply actions downstream of it.
      if (!policyHoldsTheVendorCheck(params.getPolicy(), params.holdCacheMaxAge, Date.now())) {
        params.checkForUpdates();
      }
      const env = collectEnvironment();
      // Snapshotting before the request goes out, and clearing exactly this
      // snapshot on ACK, is what keeps a fact recorded mid-flight from being
      // wiped alongside facts that were actually sent.
      const bufferedFacts = params.getBufferedFacts();
      const response = await sendCheckIn({
        connection: params.connection,
        sdkVersion: params.sdkVersion,
        channel: params.channel,
        observedVersion: env.observedVersion,
        platform: env.platform,
        arch: env.arch,
        osVersion: env.osVersion,
        attributes: params.attributes,
        adapterState: params.getAdapterState(),
        bufferedFacts,
        log: params.log,
      });
      if (response !== undefined) params.clearBufferedFacts(bufferedFacts);
      params.onPolicyResponse(response);
    } finally {
      inFlight = false;
    }
  };

  const ready = tick();
  const timer = setInterval(() => void tick(), jitteredInterval);
  const trigger = (): void => {
    void tick();
  };

  powerMonitor.on("resume", trigger);
  app.on("browser-window-focus", trigger);

  return {
    ready,
    checkNow: tick,
    stop() {
      clearInterval(timer);
      powerMonitor.removeListener("resume", trigger);
      app.removeListener("browser-window-focus", trigger);
    },
  };
}
