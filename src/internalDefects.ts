const defectCounts = new Map<string, number>();

/**
 * Tallies a bug in this SDK's own adapter code, by coarse cause, and
 * swallows it -- never crashes the host or leaks into `UpdateFailure`.
 * Counts only, never a message/stack trace -- see README for why.
 */
export function recordInternalDefect(cause: string): void {
  defectCounts.set(cause, (defectCounts.get(cause) ?? 0) + 1);
}

/** Exposed for the future reporting path and for tests; not public API yet. */
export function getInternalDefectCounts(): ReadonlyMap<string, number> {
  return defectCounts;
}

/** Runs `fn`, tallying and swallowing any throw that isn't itself an `UpdateFailure` mapping. */
export function guardAdapterCallback(cause: string, fn: () => void): void {
  try {
    fn();
  } catch {
    recordInternalDefect(cause);
  }
}
