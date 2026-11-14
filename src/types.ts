export const PROTOCOL_VERSION = 1;

export interface InitConfig {
  credential: string;
  baseUrl?: string;
  /** Developer-configurable; the server-enforced floor is 15 minutes regardless of what's passed here. */
  checkInIntervalMs?: number;
  attributes?: Record<string, string>;
  /** Off by default. Logs what the SDK is doing via `console.debug` -- never noisy unless opted in. */
  debug?: boolean;
}

/**
 * This thinnest tracer bullet only ever reports `idle` — full-wrap ownership of
 * electron-updater (checking/available/downloading/downloaded/update-cancelled/failed)
 * is a separate, not-yet-implemented follow-on.
 */
export type AdapterState = { type: "idle" } | { type: "checking" } | { type: "available" };

export interface CheckInRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  installationId: string;
  eventId: string;
  checkedInAt: string;
  sdkVersion: string;
  observedVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
  attributes: Record<string, string>;
  adapterState: AdapterState;
  /** Always empty until the local fact buffer is implemented. */
  bufferedFacts: readonly [];
}

export type Policy =
  | { type: "current"; issuedAt: string; environment: string }
  | { type: "held"; issuedAt: string; environment: string; reason?: string; until?: string }
  | {
      type: "updateEligible";
      issuedAt: string;
      environment: string;
      priority?: "normal" | "high";
    };

export interface CheckInResponse {
  protocolVersion: typeof PROTOCOL_VERSION;
  policy: string;
  signature: string;
}
