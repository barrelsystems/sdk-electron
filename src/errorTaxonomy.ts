import { recordUpdateErrorFact } from "./persistence/bufferedFacts.js";
import type { AdapterState, UpdateFailure, UpdateFailureMode } from "./types.js";

type Phase = "check" | "verify" | "download" | "extract" | "install" | "config" | "unknown";

const FAILURE_MODE_TITLES: Record<UpdateFailureMode, string> = {
  "manifest-unreachable": "Could not reach the update manifest.",
  "manifest-parse-failed": "The update manifest could not be parsed.",
  "version-invalid": "The update manifest's version is invalid.",
  "signature-missing": "The update manifest has no signature.",
  "signature-invalid": "The update manifest's signature is invalid.",
  "signature-version-mismatch": "The update's signed version doesn't match the manifest.",
  "checksum-mismatch": "The downloaded update failed its checksum check.",
  "download-transport-failed": "The update download failed at the network layer.",
  "download-file-invalid": "The downloaded update file is invalid.",
  "download-size-exceeded": "The update download exceeded its expected size.",
  "download-stream-incomplete": "The update download stream ended early.",
  "diff-patch-incompatible": "The differential update patch is incompatible.",
  "extraction-failed": "The downloaded update could not be extracted.",
  "target-not-found-in-manifest": "The expected update target is missing from the manifest.",
  "temp-storage-constraint": "A temporary-storage constraint blocked the update.",
  "install-write-failed": "The update could not be written to disk.",
  "install-auth-required-or-failed": "The update install needs or failed authorization.",
  "install-downgrade-blocked": "The update was blocked as a version downgrade.",
  "install-relaunch-failed": "The app could not relaunch after installing the update.",
  "install-missing-update": "The downloaded update file is missing at install time.",
  "config-invalid": "The updater's configuration is invalid.",
  "cors-misconfigured": "The update server's CORS headers are misconfigured.",
  "platform-unsupported": "This update isn't supported on the current platform.",
  "translocation-blocked": "macOS App Translocation blocked the update.",
  "webkit-terminated": "The updater's WebKit process terminated unexpectedly.",
  "release-notes-failed": "The update's release notes could not be loaded.",
  "resume-appcast-failed": "Resuming the update feed after a prior failure didn't work.",
  unknown: "An unclassified update failure occurred.",
};

/** `title` is resolved here, at return/display time -- never persisted or transmitted. */
export function resolveFailureTitle(failureMode: UpdateFailureMode): string {
  return FAILURE_MODE_TITLES[failureMode];
}

/** Mechanical, fixed derivation -- never a second independent classification. */
export function categoryForPhase(phase: Phase): "check" | "download" | "updater" {
  if (phase === "check") return "check";
  if (phase === "verify" || phase === "download" || phase === "extract") return "download";
  return "updater";
}

/** Builds the matching `UpdateFailure` and `AdapterState.failed` from one classification. */
export function buildFailureState(
  platform: UpdateFailure["platform"],
  failureMode: UpdateFailureMode,
  phase: Phase,
  platformCode: string,
): { failure: UpdateFailure; state: Extract<AdapterState, { type: "failed" }> } {
  const failure: UpdateFailure = {
    phase,
    failureMode,
    title: resolveFailureTitle(failureMode),
    platform,
    platformCode,
  };
  const state: Extract<AdapterState, { type: "failed" }> = {
    type: "failed",
    category: categoryForPhase(phase),
    code: failureMode,
    platformCode,
  };
  return { failure, state };
}

/**
 * The tail every adapter's own `'error'` handler needs: classify the
 * platform error and buffer it as a fact. Callers still own `lastError` and
 * `setState` themselves -- those close over adapter-local state this module
 * never sees.
 */
export function classifyAndRecordFailure(
  platform: UpdateFailure["platform"],
  failureMode: UpdateFailureMode,
  phase: Phase,
  platformCode: string,
): { failure: UpdateFailure; state: Extract<AdapterState, { type: "failed" }> } {
  const built = buildFailureState(platform, failureMode, phase, platformCode);
  recordUpdateErrorFact(built.failure);
  return built;
}

export type { Phase };
