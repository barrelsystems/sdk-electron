import type { UpdateFailureMode } from "../types.js";
import type { Phase } from "../errorTaxonomy.js";

export type BuiltinOperation = "checking" | "relaunching" | "configuring";

const PHASE_FOR_OPERATION: Record<BuiltinOperation, Phase> = {
  checking: "check",
  relaunching: "install",
  configuring: "config",
};

/**
 * No structured error code exists here -- Windows has none at all, and
 * macOS's `(domain, code)` pair isn't yet enumerated (a confirmed, open
 * gap). `unknown` is correct here, not a placeholder to fill in later.
 */
export function mapBuiltinUpdaterError(operation: BuiltinOperation): {
  failureMode: UpdateFailureMode;
  phase: Phase;
} {
  const phase = PHASE_FOR_OPERATION[operation];

  if (process.platform === "darwin") {
    if (operation === "relaunching") return { failureMode: "install-relaunch-failed", phase };
    if (operation === "configuring") return { failureMode: "config-invalid", phase };
  }

  return { failureMode: "unknown", phase };
}
