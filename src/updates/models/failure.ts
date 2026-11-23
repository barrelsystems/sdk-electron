export type FailureCategory = "check" | "download" | "updater";

export type Phase = "check" | "verify" | "download" | "extract" | "install" | "config" | "unknown";

// `unknown` is required: the builtin Windows updater exposes no native
// identifier, and native libraries may introduce unmapped failures.
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
  | "target-not-found-in-manifest"
  | "temp-storage-constraint"
  | "install-write-failed"
  | "install-auth-required-or-failed"
  | "install-relaunch-failed"
  | "install-missing-update"
  | "config-invalid"
  | "cors-misconfigured"
  | "translocation-blocked"
  | "platform-unsupported"
  | "apply-not-confirmed"
  | "unknown";

export interface UpdateFailure {
  phase: Phase;
  failureMode: UpdateFailureMode;
  /** Resolved from a static lookup table at return time -- never persisted or transmitted. */
  title: string;
  platform: "electron-updater" | "electron-builtin" | "version-check";
  platformCode: string;
}
