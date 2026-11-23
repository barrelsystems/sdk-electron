import type { UpdateState, ReportableUpdateState } from "../models/state.js";
import type { UpdateFailureMode } from "../models/failure.js";
import type { Phase } from "../models/failure.js";
import type { FactTimestamps } from "../persistence/bufferedFacts.js";

export const PROTOCOL_VERSION = 1;

export interface BackendConnection {
  baseUrl: string;
  credential: string;
  installationId: string;
}

/** The wire shape the backend's schema actually expects -- flatter than the
 * internally persisted `BufferedFact` (see `protocol/checkIn.ts`'s `toWireBufferedFact`). */
export type WireBufferedFact =
  | ({ kind: "lifecycleState"; state: UpdateState } & FactTimestamps)
  | ({
      kind: "updateError";
      phase: Phase;
      failureMode: UpdateFailureMode;
      platformCode: string;
    } & FactTimestamps);

export interface CheckInRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  installationId: string;
  eventId: string;
  checkedInAt: string;
  sdkVersion: string;
  channel: string;
  observedVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
  attributes: Record<string, string>;
  lifecycleState: ReportableUpdateState;
  bufferedFacts: readonly WireBufferedFact[];
  /** This SDK's own actual cadence, after its local floor/ceiling clamp --
   * never the raw configured value -- so the backend's stuck-tier scaling
   * reflects what this installation really does, not what it was asked to. */
  checkInIntervalMs: number;
}

export interface CheckInResponse {
  protocolVersion: typeof PROTOCOL_VERSION;
  updateEligibility: string;
  signature: string;
  // Optional new key, signed by the currently trusted key. Both fields
  // are absent when no rotation is announced.
  nextPublicKeyPem?: string;
  nextPublicKeySignature?: string;
}
