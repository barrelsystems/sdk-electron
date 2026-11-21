import type { UpdateFailureMode } from "../types.js";
import type { Phase } from "../errorTaxonomy.js";

/**
 * Every entry here is confirmed against electron-userland/electron-builder's
 * own source (both the `electron-updater`/`builder-util-runtime` versions
 * this SDK's `package.json` pins -- 6.8.11 / 9.7.0, grepped directly out of
 * `node_modules` -- and the current `main` branch, since the peer dependency
 * range (`electron-updater: >=6.0.0`) is unbounded and a host app may run a
 * much newer release). Nothing here is guessed from a code's name alone.
 */
const CODE_TO_FAILURE: Record<string, { failureMode: UpdateFailureMode; phase: Phase }> = {
  ERR_UPDATER_CHANNEL_FILE_NOT_FOUND: { failureMode: "manifest-unreachable", phase: "check" },
  ERR_UPDATER_LATEST_VERSION_NOT_FOUND: { failureMode: "manifest-unreachable", phase: "check" },
  ERR_UPDATER_RELEASE_NOT_FOUND: { failureMode: "manifest-unreachable", phase: "check" },
  ERR_UPDATER_INVALID_VERSION: { failureMode: "version-invalid", phase: "check" },
  ERR_UPDATER_INVALID_TAG: { failureMode: "version-invalid", phase: "check" },
  ERR_UPDATER_MANIFEST_NOT_SIGNED: { failureMode: "signature-missing", phase: "verify" },
  ERR_UPDATER_MANIFEST_SIGNATURE_INVALID: { failureMode: "signature-invalid", phase: "verify" },
  // NSIS Authenticode checks -- a real signer check distinct from the manifest signature above.
  ERR_UPDATER_INVALID_SIGNATURE: { failureMode: "signature-invalid", phase: "verify" },
  ERR_UPDATER_SIGNATURE_UNVERIFIABLE: { failureMode: "signature-invalid", phase: "verify" },
  // electron-updater's fallback integrity check for an *unsigned* manifest:
  // the installer's own embedded ProductVersion resource must equal the
  // manifest's claimed version. A mismatch is exactly "the update's signed
  // version doesn't match the manifest," just via this weaker substitute for
  // a cryptographic signature rather than the Ed25519 one above.
  ERR_UPDATER_INSTALLER_VERSION_MISMATCH: {
    failureMode: "signature-version-mismatch",
    phase: "verify",
  },
  ERR_UPDATER_INVALID_UPDATE_FILE: { failureMode: "download-file-invalid", phase: "download" },
  ERR_UPDATER_INVALID_FILE_NAME: { failureMode: "download-file-invalid", phase: "download" },
  ERR_UPDATER_UNSAFE_INSTALLER_PATH: { failureMode: "download-file-invalid", phase: "download" },
  ERR_CHECKSUM_MISMATCH: { failureMode: "checksum-mismatch", phase: "verify" },
  ERR_UPDATER_DOWNLOAD_SIZE_EXCEEDED: { failureMode: "download-size-exceeded", phase: "download" },
  // `ERR_HTTP_RESPONSE_TOO_LARGE` is the code this SDK's pinned 6.8.11 actually
  // throws for an oversized channel-file response; `ERR_UPDATER_RESPONSE_TOO_LARGE`
  // is the same condition under its current name on `main` -- kept side by side
  // for the whole `>=6.0.0` range, not a replacement.
  ERR_HTTP_RESPONSE_TOO_LARGE: { failureMode: "download-size-exceeded", phase: "check" },
  ERR_UPDATER_RESPONSE_TOO_LARGE: { failureMode: "download-size-exceeded", phase: "check" },
  ERR_STREAM_NOT_FINISHED: { failureMode: "download-stream-incomplete", phase: "download" },
  ERR_UPDATER_BLOCKMAP_FORMAT_CHANGED: {
    failureMode: "diff-patch-incompatible",
    phase: "download",
  },
  ERR_UPDATER_BLOCKMAP_FILE_NOT_FOUND: {
    failureMode: "diff-patch-incompatible",
    phase: "download",
  },
  ERR_UPDATER_LOOPBACK_REDIRECT: { failureMode: "download-transport-failed", phase: "download" },
  ERR_UPDATER_OLD_FILE_NOT_FOUND: { failureMode: "install-missing-update", phase: "install" },
  ERR_UPDATER_MAC_PROXY_SERVER_FAILED: { failureMode: "install-relaunch-failed", phase: "install" },
  ERR_UPDATER_CROSS_ORIGIN_HEADERS_NOT_CONFIGURED: {
    failureMode: "cors-misconfigured",
    phase: "config",
  },
  ERR_UPDATER_INVALID_CROSS_ORIGIN_HEADERS: { failureMode: "cors-misconfigured", phase: "config" },
  ERR_UPDATER_CROSS_ORIGIN_HEADER_POLICY_MISSING: {
    failureMode: "cors-misconfigured",
    phase: "config",
  },
  // The manifest/feed was reached but couldn't be understood -- malformed
  // JSON/XML/YAML, a feed missing its expected elements, or (for the older
  // Bitbucket/Keygen path) a manifest with no checksum field at all.
  ERR_UPDATER_INVALID_RELEASE_FEED: { failureMode: "manifest-parse-failed", phase: "check" },
  ERR_UPDATER_INVALID_UPDATE_INFO: { failureMode: "manifest-parse-failed", phase: "check" },
  ERR_XML_MISSED_ELEMENT: { failureMode: "manifest-parse-failed", phase: "check" },
  // Thrown by `builder-util-runtime`'s `parseXml` itself (before any
  // `.element()`/`.attribute()` lookup) on malformed tag/attribute syntax --
  // reachable via `GitHubProvider`'s unguarded Atom-feed `parseXml` call.
  ERR_XML_ELEMENT_NAME_EMPTY: { failureMode: "manifest-parse-failed", phase: "check" },
  ERR_XML_ELEMENT_INVALID_NAME: { failureMode: "manifest-parse-failed", phase: "check" },
  ERR_XML_MISSED_ATTRIBUTE: { failureMode: "manifest-parse-failed", phase: "check" },
  ERR_UPDATER_NO_CHECKSUM: { failureMode: "manifest-parse-failed", phase: "check" },
  // The manifest/feed parsed fine but doesn't list a usable target for this
  // install -- no release matching the channel, no asset/file entry, no
  // package for this arch.
  ERR_UPDATER_NO_PUBLISHED_VERSIONS: {
    failureMode: "target-not-found-in-manifest",
    phase: "check",
  },
  ERR_UPDATER_ASSET_NOT_FOUND: { failureMode: "target-not-found-in-manifest", phase: "check" },
  ERR_UPDATER_NO_FILES_PROVIDED: { failureMode: "target-not-found-in-manifest", phase: "check" },
  ERR_UPDATER_ZIP_FILE_NOT_FOUND: { failureMode: "target-not-found-in-manifest", phase: "check" },
  ERR_UPDATER_NO_WEB_PACKAGE_FOR_ARCH: {
    failureMode: "target-not-found-in-manifest",
    phase: "download",
  },
  // Host/developer misconfiguration -- never something the end user's
  // environment or network caused.
  ERR_UPDATER_INVALID_CHANNEL: { failureMode: "config-invalid", phase: "config" },
  ERR_UPDATER_INVALID_MAX_UPDATE_INFO_SIZE: { failureMode: "config-invalid", phase: "config" },
  ERR_UPDATER_WEB_INSTALLER_DISABLED: { failureMode: "config-invalid", phase: "config" },
  ERR_UPDATER_NO_PUBLISHER_NAME: { failureMode: "config-invalid", phase: "config" },
  ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION: { failureMode: "config-invalid", phase: "config" },
  ERR_UPDATER_UNSUPPORTED_PROVIDER: { failureMode: "config-invalid", phase: "config" },
  ERR_UPDATER_FEED_BASE_URL_NOT_DECLARED: { failureMode: "config-invalid", phase: "config" },
  ERR_UPDATER_INSECURE_FEED: { failureMode: "config-invalid", phase: "config" },
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
 * Node's own fs errno codes for the download's destination write stream --
 * `builder-util-runtime`'s `httpExecutor.ts` pipes the response straight into
 * `fs.createWriteStream(destination)` and forwards whatever error it emits
 * unchanged, so these real, standard Node errno strings survive to `error.code`.
 */
const NODE_STORAGE_ERRNO_CODES = new Set([
  "ENOSPC", // no space left on device
  "EROFS", // read-only file system
  "EDQUOT", // disk quota exceeded
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

  // electron-updater's own `ElevationDeniedError` (Linux pkexec refusing to
  // run the package manager -- the authentication dialog was dismissed, or
  // authorization wasn't obtained) carries no `.code` at all, only `.name`
  // -- see electron-updater's `LinuxUpdater.ts`.
  if (error.name === "ElevationDeniedError") {
    return { failureMode: "install-auth-required-or-failed", phase: "install" };
  }

  if (code === "HTTP_ERROR_404" && currentPhase === "check") {
    return { failureMode: "manifest-unreachable", phase: "check" };
  }
  if (code !== undefined && code.startsWith("HTTP_ERROR_")) {
    return { failureMode: "download-transport-failed", phase: "download" };
  }
  if (code !== undefined && code in CODE_TO_FAILURE) {
    return CODE_TO_FAILURE[code] as { failureMode: UpdateFailureMode; phase: Phase };
  }
  if (code !== undefined && NODE_STORAGE_ERRNO_CODES.has(code)) {
    return { failureMode: "temp-storage-constraint", phase: "download" };
  }
  if (code !== undefined && NODE_NETWORK_ERRNO_CODES.has(code)) {
    return { failureMode: "download-transport-failed", phase: "download" };
  }

  return { failureMode: "unknown", phase: "unknown" };
}
