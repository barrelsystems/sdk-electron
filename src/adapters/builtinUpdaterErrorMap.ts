import type { UpdateFailureMode } from "../types.js";
import type { Phase } from "../errorTaxonomy.js";

export type BuiltinOperation = "checking" | "relaunching" | "configuring";

/** Present only via Electron's native 3-arg `OnError(message, code, domain)`
 * overload (`electron_api_auto_updater.cc`); absent for message-only errors
 * and always absent on Windows. */
export interface BuiltinUpdaterError extends Error {
  code?: number;
  domain?: string;
}

const PHASE_FOR_OPERATION: Record<BuiltinOperation, Phase> = {
  checking: "check",
  relaunching: "install",
  configuring: "config",
};

// Real (domain, code) pairs raised by Electron's forked Squirrel.Mac
// (`electron/Squirrel.Mac`) through the 3-arg `OnError` path, confirmed
// against that fork's own `.h`/`.m` sources.
const MAC_DOMAIN_CODE_TO_FAILURE: Record<
  string,
  Record<number, { failureMode: UpdateFailureMode; phase: Phase }>
> = {
  // SQRLCodeSignatureErrorDomain (SQRLCodeSignature.m): -1 DidNotPass, -2
  // CouldNotCreateStaticCode -- the staged update bundle failed codesign
  // verification.
  SQRLCodeSignatureErrorDomain: {
    "-1": { failureMode: "signature-invalid", phase: "verify" },
    "-2": { failureMode: "signature-invalid", phase: "verify" },
  },
  // SQRLInstallerErrorDomain (SQRLInstaller.m): -1..-8, all on-disk install
  // mechanics (backup, replace/open-target, version/resume-state read,
  // cross-volume move, permissions) failing while applying the update.
  SQRLInstallerErrorDomain: {
    "-1": { failureMode: "install-write-failed", phase: "install" },
    "-2": { failureMode: "install-write-failed", phase: "install" },
    "-3": { failureMode: "install-write-failed", phase: "install" },
    "-4": { failureMode: "install-write-failed", phase: "install" },
    "-5": { failureMode: "install-write-failed", phase: "install" },
    "-6": { failureMode: "install-write-failed", phase: "install" },
    "-7": { failureMode: "install-write-failed", phase: "install" },
    "-8": { failureMode: "install-write-failed", phase: "install" },
  },
  // SQRLUpdaterErrorDomain (SQRLUpdater.m): malformed check response, a
  // missing downloaded bundle, ShipIt failing to prepare, or (code 8) a
  // read-only volume -- the condition macOS App Translocation produces.
  SQRLUpdaterErrorDomain: {
    "2": { failureMode: "install-missing-update", phase: "install" },
    "3": { failureMode: "install-write-failed", phase: "install" },
    "4": { failureMode: "signature-invalid", phase: "verify" },
    "5": { failureMode: "manifest-parse-failed", phase: "check" },
    "6": { failureMode: "manifest-parse-failed", phase: "check" },
    "7": { failureMode: "manifest-parse-failed", phase: "check" },
    "8": { failureMode: "translocation-blocked", phase: "check" },
  },
};

export function mapBuiltinUpdaterError(
  error: BuiltinUpdaterError,
  operation: BuiltinOperation,
): {
  failureMode: UpdateFailureMode;
  phase: Phase;
} {
  const phase = PHASE_FOR_OPERATION[operation];

  if (process.platform === "darwin") {
    if (error.domain !== undefined && error.code !== undefined) {
      const match = MAC_DOMAIN_CODE_TO_FAILURE[error.domain]?.[error.code];
      if (match !== undefined) return match;
    }
    if (operation === "relaunching") return { failureMode: "install-relaunch-failed", phase };
    if (operation === "configuring") return { failureMode: "config-invalid", phase };
  }

  // Windows: every reachable builtin-updater failure is a plain
  // `new Error(message)` with no `.code` (confirmed against
  // auto-updater-win.ts/squirrel-update-win.ts) -- `unknown` is correct here.
  return { failureMode: "unknown", phase };
}
