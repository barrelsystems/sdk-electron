import { app, powerMonitor } from "electron";
import { sendCheckIn } from "./protocol/checkIn.js";
import { collectEnvironment } from "./env.js";
import { computeJitterFraction } from "./jitter.js";
import type { BufferedFact } from "./persistence/bufferedFacts.js";
import type { UpdateState, ReportableUpdateState } from "./models/state.js";
import type { UpdateEligibility } from "./models/eligibility.js";
import type { BackendConnection, CheckInResponse } from "./protocol/wireTypes.js";
import { isReportableUpdateState } from "./models/state.js";

export const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const MIN_INTERVAL_MS = 15 * 60 * 1000;
/** Keeps the backend's own escalating stuck-detection meaningfully faster
 * than its longer-range liveness window, regardless of what interval a
 * host configures. */
const MAX_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_HOLD_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_HOLD_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Collapses a burst of reportable state transitions (chiefly rapid
 * `downloading` progress updates) into one outgoing check-in. */
const STATE_SYNC_DEBOUNCE_MS = 5_000;

export interface CadenceParams {
  connection: BackendConnection;
  checkInIntervalMs: number;
  sdkVersion: string;
  channel: string;
  attributes: Record<string, string>;
  retryInstallationPersistence: () => void;
  getUpdateState: () => UpdateState;
  /** Registers a listener for every local adapter-state transition,
   * `checking` included -- cadence filters that out itself via
   * `isReportableUpdateState` before deciding whether to sync. */
  subscribeToStateChanges: (listener: (state: UpdateState) => void | Promise<void>) => void;
  getBufferedFacts: () => readonly BufferedFact[];
  /** Called only once ingestion ACKs the check-in that carried `sent` -- never optimistically. */
  clearBufferedFacts: (sent: readonly BufferedFact[]) => void;
  onEligibilityResponse: (response: CheckInResponse | undefined) => void;
  checkForUpdates: () => void;
  getUpdateEligibility: () => UpdateEligibility | undefined;
  holdCacheMaxAge: number;
  log?: ((message: string) => void) | undefined;
}

/** `undefined`/`unrestricted`/`eligible` never hold the check -- only a confirmed `held` UpdateEligibility
 * within its ceiling (the earlier of `holdCacheMaxAge` and the operator's own `until`) does, so an offline
 * client fails open. */
export function holdBlocksTheVendorCheck(
  updateEligibility: UpdateEligibility | undefined,
  holdCacheMaxAge: number,
  now: number,
): boolean {
  if (updateEligibility?.type !== "held") return false;
  if (now - Date.parse(updateEligibility.issuedAt) > holdCacheMaxAge) return false;
  if (updateEligibility.until !== undefined && now > Date.parse(updateEligibility.until))
    return false;
  return true;
}

/** One open leading+trailing debounce window: `scheduleDebouncedSync` owns
 * its full lifecycle, from opening it through firing its trailing sync. */
interface DebounceWindow {
  timer: ReturnType<typeof setTimeout>;
  trailingSyncPending: boolean;
  resolvers: (() => void)[];
}

/** Checks in on launch, then on a jittered interval, plus on resume-from-sleep and foreground/focus.
 * Overlapping attempts are impossible: a tick that fires while the previous one is still in flight is
 * skipped, not queued. */
export interface Cadence {
  ready: Promise<void>;
  intervalMs: number;
  readonly inFlight: boolean;
  checkNow(): Promise<void>;
  stop(): void;
}

export function startCadence(params: CadenceParams): Cadence {
  if (params.checkInIntervalMs < MIN_INTERVAL_MS) {
    params.log?.(
      `cadence: requested interval ${params.checkInIntervalMs}ms is below the ${MIN_INTERVAL_MS}ms floor, clamped`,
    );
  }
  if (params.checkInIntervalMs > MAX_INTERVAL_MS) {
    params.log?.(
      `cadence: requested interval ${params.checkInIntervalMs}ms is above the ${MAX_INTERVAL_MS}ms ceiling, clamped`,
    );
  }
  const interval = Math.min(
    Math.max(Math.round(params.checkInIntervalMs), MIN_INTERVAL_MS),
    MAX_INTERVAL_MS,
  );
  const jitterFraction = computeJitterFraction(params.connection.installationId);
  const jitteredInterval = Math.round(interval * (1 + jitterFraction));

  let inFlight = false;
  let stopped = false;
  // Tracks whatever `performSend()` call is currently running, so a
  // state-triggered sync can wait on it instead of just skipping.
  let currentOperation: Promise<void> | undefined;
  // `checking` can never land here -- `isReportableUpdateState` filters
  // it, so a tick that happens to fire mid-check still reports the last
  // state that actually meant something.
  const initialState = params.getUpdateState();
  // Falls back to `idle` explicitly rather than assume the adapter always
  // starts there -- true in practice, but not a guarantee this makes.
  let lastReportableState: ReportableUpdateState = isReportableUpdateState(initialState)
    ? initialState
    : { type: "idle" };
  // `undefined` means closed -- see `scheduleDebouncedSync` below for why
  // each edge of an open window exists.
  let debounceWindow: DebounceWindow | undefined;
  // A heartbeat that already attempted a revision satisfies its trailing sync; retain newer
  // unsent revisions.
  let stateRevision = 0;
  let lastSentRevision = -1;

  const performSend = async (): Promise<void> => {
    inFlight = true;
    const revisionBeingSent = stateRevision;
    try {
      params.retryInstallationPersistence();
      const env = collectEnvironment();
      // Snapshotting before the request goes out, and clearing exactly this
      // snapshot on ACK, is what keeps a fact recorded mid-flight from being
      // wiped alongside facts that were actually sent.
      const bufferedFacts = params.getBufferedFacts();
      const response = await sendCheckIn({
        connection: params.connection,
        sdkVersion: params.sdkVersion,
        channel: params.channel,
        observedVersion: env.observedVersion,
        platform: env.platform,
        arch: env.arch,
        osVersion: env.osVersion,
        attributes: params.attributes,
        lifecycleState: lastReportableState,
        bufferedFacts,
        checkInIntervalMs: interval,
        log: params.log,
      });
      lastSentRevision = revisionBeingSent;
      if (response !== undefined) params.clearBufferedFacts(bufferedFacts);
      params.onEligibilityResponse(response);
    } finally {
      inFlight = false;
      currentOperation = undefined;
    }
  };

  // Periodic cadence only: overlapping attempts are skipped, not queued --
  // the next scheduled tick arrives soon regardless.
  const sendStateCheckIn = (): Promise<void> => {
    if (inFlight) {
      params.log?.("cadence: check-in skipped, one is already in flight");
      return Promise.resolve();
    }
    currentOperation = performSend();
    return currentOperation;
  };

  // State-triggered sync only: never silently dropped. A one-shot
  // transition like `applying` has no "next tick" to fall back on, so
  // this waits out whatever's in flight, then sends for real.
  const sendStateCheckInRetrying = async ({ force = false } = {}): Promise<void> => {
    while (inFlight && currentOperation) {
      params.log?.("cadence: state sync deferred, waiting on an in-flight check-in");
      await currentOperation;
    }

    if (stopped || (!force && stateRevision === lastSentRevision)) return;

    currentOperation = performSend();
    return currentOperation;
  };

  const tick = async (): Promise<void> => {
    if (stopped || inFlight) return;

    // The vendor update-feed check piggybacks on this same cadence but
    // MUST NOT run while held -- a Hold gates the check itself, not just
    // the download/apply actions downstream of it.
    if (
      !holdBlocksTheVendorCheck(params.getUpdateEligibility(), params.holdCacheMaxAge, Date.now())
    ) {
      params.checkForUpdates();
    }
    // A synchronous vendor callback may already have started the same sync.
    await (currentOperation ?? sendStateCheckIn());
  };

  const scheduleDebouncedSync = (): Promise<void> => {
    function closeWindow(): void {
      const closed = debounceWindow;
      debounceWindow = undefined;
      if (closed === undefined) return;

      const release = (): void => {
        for (const resolve of closed.resolvers) resolve();
      };

      // A heartbeat (or an explicit `checkNow()`) landing inside this same
      // window may have already put the current state on the wire --
      // firing again here would just resend an identical payload.
      if (closed.trailingSyncPending && stateRevision !== lastSentRevision) {
        void sendStateCheckInRetrying().then(release, release);
      } else {
        release();
      }
    }

    if (debounceWindow === undefined) {
      // Leading edge: fires immediately, not after a delay -- critical for
      // a one-shot transition like `applying`, which can be followed
      // within milliseconds by the process exiting for good.
      const leading = sendStateCheckInRetrying();
      debounceWindow = {
        trailingSyncPending: false,
        resolvers: [],
        timer: setTimeout(closeWindow, STATE_SYNC_DEBOUNCE_MS),
      };
      return leading;
    }
    // Inside an already-open window: absorbed, deferred to its trailing edge.
    debounceWindow.trailingSyncPending = true;
    clearTimeout(debounceWindow.timer);
    debounceWindow.timer = setTimeout(closeWindow, STATE_SYNC_DEBOUNCE_MS);

    return new Promise<void>((resolve) => {
      debounceWindow?.resolvers.push(resolve);
    });
  };

  params.subscribeToStateChanges((state) => {
    if (stopped || !isReportableUpdateState(state)) return undefined;
    lastReportableState = state;
    stateRevision += 1;
    if (state.type === "applying") return sendStateCheckInRetrying({ force: true });

    return scheduleDebouncedSync();
  });

  const ready = tick();
  const timer = setInterval(() => void tick(), jitteredInterval);
  const trigger = (): void => {
    void tick();
  };

  powerMonitor.on("resume", trigger);
  app.on("browser-window-focus", trigger);

  return {
    ready,
    intervalMs: jitteredInterval,
    get inFlight() {
      return inFlight;
    },
    checkNow: tick,
    stop() {
      stopped = true;
      if (debounceWindow !== undefined) {
        clearTimeout(debounceWindow.timer);
        // Nothing further will ever sync once stopped -- release anyone
        // awaiting an absorbed sync rather than leave them hanging forever.
        for (const resolve of debounceWindow.resolvers) resolve();
        debounceWindow = undefined;
      }
      clearInterval(timer);
      powerMonitor.removeListener("resume", trigger);
      app.removeListener("browser-window-focus", trigger);
    },
  };
}
