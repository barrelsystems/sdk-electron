import { app, powerMonitor } from "electron";
import { sendCheckIn } from "./checkIn.js";
import { collectEnvironment } from "./env.js";
import { computeJitterFraction } from "./jitter.js";
import type { BufferedFact } from "./persistence/bufferedFacts.js";
import type { AdapterState, CheckInResponse } from "./types.js";

export const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
export const MIN_INTERVAL_MS = 15 * 60 * 1000;

export interface CadenceParams {
  baseUrl: string;
  credential: string;
  installationId: string;
  checkInIntervalMs: number;
  sdkVersion: string;
  attributes: Record<string, string>;
  getAdapterState: () => AdapterState;
  getBufferedFacts: () => readonly BufferedFact[];
  /** Called only once ingestion ACKs the check-in that carried `sent` -- never optimistically. */
  clearBufferedFacts: (sent: readonly BufferedFact[]) => void;
  onPolicyResponse: (response: CheckInResponse | undefined) => void;
  checkForUpdates: () => void;
  log?: ((message: string) => void) | undefined;
}

/**
 * Checks in on launch, then on a jittered interval, plus on resume-from-sleep
 * and foreground/focus. Overlapping attempts are impossible: a tick that fires
 * while the previous one is still in flight is skipped, not queued.
 */
export function startCadence(params: CadenceParams): void {
  if (params.checkInIntervalMs < MIN_INTERVAL_MS) {
    params.log?.(
      `cadence: requested interval ${params.checkInIntervalMs}ms is below the ${MIN_INTERVAL_MS}ms floor, clamped`,
    );
  }
  const interval = Math.max(params.checkInIntervalMs, MIN_INTERVAL_MS);
  const jitterFraction = computeJitterFraction(params.installationId);
  const jitteredInterval = Math.round(interval * (1 + jitterFraction));

  let inFlight = false;

  const tick = async (): Promise<void> => {
    if (inFlight) {
      params.log?.("cadence: tick skipped, a check-in is already in flight");
      return;
    }
    inFlight = true;
    try {
      params.checkForUpdates();
      const env = collectEnvironment();
      // Snapshotting before the request goes out, and clearing exactly this
      // snapshot on ACK, is what keeps a fact recorded mid-flight from being
      // wiped alongside facts that were actually sent.
      const bufferedFacts = params.getBufferedFacts();
      const response = await sendCheckIn({
        baseUrl: params.baseUrl,
        credential: params.credential,
        installationId: params.installationId,
        sdkVersion: params.sdkVersion,
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

  void tick();
  setInterval(() => void tick(), jitteredInterval);

  powerMonitor.on("resume", () => void tick());
  app.on("browser-window-focus", () => void tick());
}
