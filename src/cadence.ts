import { app, powerMonitor } from "electron";
import { sendCheckIn } from "./checkIn.js";
import { collectEnvironment } from "./env.js";
import { computeJitterFraction } from "./jitter.js";
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
        log: params.log,
      });
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
