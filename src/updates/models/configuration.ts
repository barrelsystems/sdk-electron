export interface Config {
  /** Developer-configurable; the server-enforced floor is 15 minutes regardless of what's passed here. */
  checkInIntervalMs?: number;
  /** The host app's release channel, reported verbatim. Defaults to "stable". */
  channel?: string;
  attributes?: Record<string, string>;
  /** Request automatic downloads by default; disable for explicit manual control. */
  autoDownload?: boolean;
  /** Where your own update feed lives. Omit to use whatever the host
   * app's own packaging tool already configured at build time. */
  updateFeedURL?: string;
  /** Milliseconds. Default 24h; `init()` throws synchronously above the
   * 7-day ceiling. A cached `held` UpdateEligibility older than this fails open. */
  holdCacheMaxAge?: number;
}
