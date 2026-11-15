import type { UpdateFailureMode } from "../types.js";
import type { Phase } from "../errorTaxonomy.js";

const CODE_TO_FAILURE: Record<string, { failureMode: UpdateFailureMode; phase: Phase }> = {
  ERR_UPDATER_CHANNEL_FILE_NOT_FOUND: { failureMode: "manifest-unreachable", phase: "check" },
  ERR_UPDATER_INVALID_VERSION: { failureMode: "version-invalid", phase: "check" },
  ERR_UPDATER_MANIFEST_NOT_SIGNED: { failureMode: "signature-missing", phase: "verify" },
  ERR_UPDATER_MANIFEST_SIGNATURE_INVALID: { failureMode: "signature-invalid", phase: "verify" },
  ERR_UPDATER_INVALID_UPDATE_FILE: { failureMode: "download-file-invalid", phase: "download" },
  ERR_CHECKSUM_MISMATCH: { failureMode: "checksum-mismatch", phase: "verify" },
  ERR_UPDATER_DOWNLOAD_SIZE_EXCEEDED: { failureMode: "download-size-exceeded", phase: "download" },
  ERR_HTTP_RESPONSE_TOO_LARGE: { failureMode: "download-size-exceeded", phase: "download" },
  ERR_STREAM_NOT_FINISHED: { failureMode: "download-stream-incomplete", phase: "download" },
  ERR_UPDATER_BLOCKMAP_FORMAT_CHANGED: {
    failureMode: "diff-patch-incompatible",
    phase: "download",
  },
  ERR_UPDATER_OLD_FILE_NOT_FOUND: { failureMode: "install-missing-update", phase: "install" },
  ERR_UPDATER_CROSS_ORIGIN_HEADERS_NOT_CONFIGURED: {
    failureMode: "cors-misconfigured",
    phase: "config",
  },
  ERR_UPDATER_INVALID_CROSS_ORIGIN_HEADERS: { failureMode: "cors-misconfigured", phase: "config" },
};

/** Node's own network errno codes -- distinct from builder-util-runtime's ERR_* codes above. */
const NODE_NETWORK_ERRNO_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "EAI_AGAIN",
]);

/**
 * `HTTP_ERROR_404` means a missing manifest only while a check is in
 * flight; everywhere else (including every other HTTP_ERROR_<status>) it's
 * a generic transport failure -- the one code resolved by call context.
 */
export function mapElectronUpdaterError(
  error: Error & { code?: string },
  currentPhase: "check" | "download" | "idle",
): { failureMode: UpdateFailureMode; phase: Phase } {
  const code = error.code;

  if (code === "HTTP_ERROR_404" && currentPhase === "check") {
    return { failureMode: "manifest-unreachable", phase: "check" };
  }
  if (code !== undefined && code.startsWith("HTTP_ERROR_")) {
    return { failureMode: "download-transport-failed", phase: "download" };
  }
  if (code !== undefined && code in CODE_TO_FAILURE) {
    return CODE_TO_FAILURE[code] as { failureMode: UpdateFailureMode; phase: Phase };
  }
  if (code !== undefined && NODE_NETWORK_ERRNO_CODES.has(code)) {
    return { failureMode: "download-transport-failed", phase: "download" };
  }

  return { failureMode: "unknown", phase: "unknown" };
}
