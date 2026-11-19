import type { Phase } from "./errorTaxonomy.js";
import type { FactTimestamps } from "./persistence/bufferedFacts.js";

export const PROTOCOL_VERSION = 1;

export interface InitConfig {
  credential: string;
  baseUrl?: string;
  /** Developer-configurable; the server-enforced floor is 15 minutes regardless of what's passed here. */
  checkInIntervalMs?: number;
  attributes?: Record<string, string>;
  /** On by default. When off, a found update is never downloaded. */
  autoDownload?: boolean;
  /** Where your own update feed lives. Omit to use whatever the host
   * app's own packaging tool already configured at build time. */
  updateFeedURL?: string;
  /** Off by default. Logs what the SDK is doing via `console.debug` -- never noisy unless opted in. */
  debug?: boolean;
  /** Milliseconds. Default 24h; `init()` throws synchronously above the
   * 7-day ceiling. A cached `held` Policy older than this fails open. */
  holdCacheMaxAge?: number;
}

export type AdapterState =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; releaseNotes?: string }
  | { type: "downloading"; progress?: number; releaseNotes?: string }
  | { type: "downloaded"; releaseNotes?: string }
  | { type: "update-cancelled" }
  | {
      type: "failed";
      category: "check" | "download" | "updater";
      code: UpdateFailureMode;
      platformCode: string;
    };

/**
 * The stable, cross-platform fingerprint for a classified update failure.
 * `unknown` is required and load-bearing, never a fallback that "shouldn't happen" --
 * electron-builtin's Windows path has no library-sourced identifier at all.
 */
export type UpdateFailureMode =
  | "manifest-unreachable"
  | "manifest-parse-failed"
  | "version-invalid"
  | "signature-missing"
  | "signature-invalid"
  | "signature-version-mismatch"
  | "checksum-mismatch"
  | "download-transport-failed"
  | "download-file-invalid"
  | "download-size-exceeded"
  | "download-stream-incomplete"
  | "diff-patch-incompatible"
  | "extraction-failed"
  | "target-not-found-in-manifest"
  | "temp-storage-constraint"
  | "install-write-failed"
  | "install-auth-required-or-failed"
  | "install-downgrade-blocked"
  | "install-relaunch-failed"
  | "install-missing-update"
  | "config-invalid"
  | "cors-misconfigured"
  | "platform-unsupported"
  | "translocation-blocked"
  | "webkit-terminated"
  | "release-notes-failed"
  | "resume-appcast-failed"
  | "unknown";

export interface UpdateFailure {
  phase: Phase;
  failureMode: UpdateFailureMode;
  /** Resolved from a static lookup table at return time -- never persisted or transmitted. */
  title: string;
  platform: "electron-updater" | "electron-builtin";
  platformCode: string;
}

/** The wire shape the backend's schema actually expects -- flatter than the
 * internally persisted `BufferedFact` (see `protocol/checkIn.ts`'s `toWireBufferedFact`). */
export type WireBufferedFact =
  | ({ kind: "adapterState"; state: AdapterState } & FactTimestamps)
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
  observedVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
  attributes: Record<string, string>;
  adapterState: AdapterState;
  bufferedFacts: readonly WireBufferedFact[];
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
  /**
   * A key-rotation announcement: a new public key, signed by the key this SDK
   * currently trusts. Both absent when no rotation is in flight -- additive,
   * never required by a server that has nothing to rotate.
   */
  nextPublicKeyPem?: string;
  nextPublicKeySignature?: string;
}
