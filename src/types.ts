import type { Phase } from "./errorTaxonomy.js";

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

export type AdapterState =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available" }
  | { type: "downloading"; progress?: number }
  | { type: "downloaded" }
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
  | "sdk-misuse"
  | "translocation-blocked"
  | "webkit-terminated"
  | "release-notes-failed"
  | "update-check-declined"
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
