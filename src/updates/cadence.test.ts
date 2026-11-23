import { afterEach, describe, expect, it, vi } from "vitest";
import { holdBlocksTheVendorCheck, startCadence } from "./cadence.js";
import type { UpdateState } from "./models/state.js";
import type { UpdateEligibility } from "./models/eligibility.js";

/** Models adapter listeners while keeping cadence tests independent of
 * native updater event mapping. */
function createStateChangeHub() {
  const listeners: ((state: UpdateState) => void | Promise<void>)[] = [];
  return {
    subscribe: (listener: (state: UpdateState) => void | Promise<void>) => {
      listeners.push(listener);
    },
    emit: (state: UpdateState): Promise<void> =>
      Promise.all(listeners.map((listener) => listener(state))).then(() => undefined),
  };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse("2026-01-10T00:00:00.000Z");

describe("holdBlocksTheVendorCheck", () => {
  it("returns false when there is no UpdateEligibility yet", () => {
    expect(holdBlocksTheVendorCheck(undefined, DAY_MS, NOW)).toBe(false);
  });

  it("returns false for an unrestricted UpdateEligibility", () => {
    const unrestricted: UpdateEligibility = {
      type: "unrestricted",
      issuedAt: "2026-01-09T23:00:00.000Z",
      environment: "production",
    };
    expect(holdBlocksTheVendorCheck(unrestricted, DAY_MS, NOW)).toBe(false);
  });

  it("returns false for an eligible UpdateEligibility", () => {
    const eligible: UpdateEligibility = {
      type: "eligible",
      issuedAt: "2026-01-09T23:00:00.000Z",
      environment: "production",
    };
    expect(holdBlocksTheVendorCheck(eligible, DAY_MS, NOW)).toBe(false);
  });

  it("returns true for a held UpdateEligibility issued 1 hour ago, under the default 24h ceiling", () => {
    const held: UpdateEligibility = {
      type: "held",
      issuedAt: new Date(NOW - HOUR_MS).toISOString(),
      environment: "production",
    };
    expect(holdBlocksTheVendorCheck(held, DAY_MS, NOW)).toBe(true);
  });

  it("fails open once the held UpdateEligibility's age exceeds holdCacheMaxAge", () => {
    const held: UpdateEligibility = {
      type: "held",
      issuedAt: new Date(NOW - DAY_MS - HOUR_MS).toISOString(),
      environment: "production",
    };
    expect(holdBlocksTheVendorCheck(held, DAY_MS, NOW)).toBe(false);
  });

  it("fails open once the operator's own `until` has passed, even under holdCacheMaxAge", () => {
    const held: UpdateEligibility = {
      type: "held",
      issuedAt: new Date(NOW - HOUR_MS).toISOString(),
      environment: "production",
      until: new Date(NOW - 1000).toISOString(),
    };
    expect(holdBlocksTheVendorCheck(held, DAY_MS, NOW)).toBe(false);
  });

  it("still holds when `until` is in the future", () => {
    const held: UpdateEligibility = {
      type: "held",
      issuedAt: new Date(NOW - HOUR_MS).toISOString(),
      environment: "production",
      until: new Date(NOW + HOUR_MS).toISOString(),
    };
    expect(holdBlocksTheVendorCheck(held, DAY_MS, NOW)).toBe(true);
  });
});

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    app: Object.assign(new EventEmitter(), { getVersion: () => "1.0.0" }),
    powerMonitor: new EventEmitter(),
  };
});
vi.mock("./protocol/checkIn.js", () => ({ sendCheckIn: vi.fn(async () => undefined) }));

import { app, powerMonitor } from "electron";
import { sendCheckIn } from "./protocol/checkIn.js";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function baseCadenceParams(overrides: Partial<Parameters<typeof startCadence>[0]> = {}) {
  return {
    connection: {
      baseUrl: "http://localhost",
      credential: "test",
      installationId: "test-installation",
    },
    checkInIntervalMs: 900_000,
    sdkVersion: "test",
    channel: "stable",
    attributes: {},
    retryInstallationPersistence: () => {},
    getUpdateState: () => ({ type: "idle" as const }),
    subscribeToStateChanges: () => {},
    getBufferedFacts: () => [],
    clearBufferedFacts: () => {},
    onEligibilityResponse: () => {},
    checkForUpdates: () => {},
    getUpdateEligibility: () => undefined,
    holdCacheMaxAge: DAY_MS,
    ...overrides,
  };
}

it("keeps the fixed timer anchored across focus and removes lifecycle listeners on stop", async () => {
  vi.useFakeTimers();
  const cadence = startCadence(baseCadenceParams());
  try {
    await cadence.ready;
    expect(sendCheckIn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(cadence.intervalMs / 2);
    app.emit("browser-window-focus");
    await vi.advanceTimersByTimeAsync(0);
    expect(sendCheckIn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(cadence.intervalMs / 2);
    expect(sendCheckIn).toHaveBeenCalledTimes(3);
    cadence.stop();
    app.emit("browser-window-focus");
    powerMonitor.emit("resume");
    await vi.advanceTimersByTimeAsync(cadence.intervalMs * 2);
    expect(sendCheckIn).toHaveBeenCalledTimes(3);
  } finally {
    cadence.stop();
  }
});

it("clamps a below-floor interval and logs it, but reports an above-ceiling interval clamped too", async () => {
  vi.useFakeTimers();
  const log = vi.fn();
  const cadence = startCadence(baseCadenceParams({ checkInIntervalMs: 60_000, log }));
  try {
    await cadence.ready;
    expect(log).toHaveBeenCalledWith(expect.stringContaining("below the 900000ms floor"));
  } finally {
    cadence.stop();
  }

  vi.clearAllMocks();
  const aboveCeiling = startCadence(
    baseCadenceParams({ checkInIntervalMs: 6 * 60 * 60 * 1000, log }),
  );
  try {
    await aboveCeiling.ready;
    expect(log).toHaveBeenCalledWith(expect.stringContaining("above the 7200000ms ceiling"));
    // Clamped to the 2h ceiling, not the raw 6h request.
    expect(aboveCeiling.intervalMs).toBeLessThanOrEqual(2 * 60 * 60 * 1000 * 1.5);
  } finally {
    aboveCeiling.stop();
  }
});

it("reports the clamped checkInIntervalMs, not the raw configured value, on the periodic check-in", async () => {
  vi.useFakeTimers();
  const cadence = startCadence(baseCadenceParams({ checkInIntervalMs: 60_000 }));
  try {
    await cadence.ready;
    const call = vi.mocked(sendCheckIn).mock.calls.at(-1)?.[0];
    expect(call?.checkInIntervalMs).toBe(900_000); // clamped to MIN_INTERVAL_MS, not the raw 60_000
  } finally {
    cadence.stop();
  }
});

it("reports configured fractional milliseconds rounded to the persisted wire unit", async () => {
  const cadence = startCadence(baseCadenceParams({ checkInIntervalMs: 1_800_000.6 }));

  try {
    await cadence.ready;
    expect(vi.mocked(sendCheckIn).mock.calls.at(-1)?.[0]?.checkInIntervalMs).toBe(1_800_001);
  } finally {
    cadence.stop();
  }
});

it("reports the same clamped checkInIntervalMs on a debounced state-triggered sync", async () => {
  vi.useFakeTimers();
  const hub = createStateChangeHub();
  const cadence = startCadence(
    baseCadenceParams({
      checkInIntervalMs: 6 * 60 * 60 * 1000, // above the 2h ceiling
      subscribeToStateChanges: hub.subscribe,
    }),
  );
  try {
    await cadence.ready;
    await hub.emit({ type: "applying" });
    const call = vi.mocked(sendCheckIn).mock.calls.at(-1)?.[0];
    expect(call?.checkInIntervalMs).toBe(2 * 60 * 60 * 1000); // clamped to MAX_INTERVAL_MS
  } finally {
    cadence.stop();
  }
});

it("fires immediately on an isolated transition -- critical for `applying`, which can be followed within milliseconds by the process exiting for good", async () => {
  vi.useFakeTimers();
  const hub = createStateChangeHub();
  const cadence = startCadence(baseCadenceParams({ subscribeToStateChanges: hub.subscribe }));
  try {
    await cadence.ready;
    expect(sendCheckIn).toHaveBeenCalledTimes(1);

    hub.emit({ type: "applying" });
    // No time advanced at all -- the leading edge fires synchronously, not
    // after any debounce delay.
    expect(sendCheckIn).toHaveBeenCalledTimes(2);
    const lastCall = vi.mocked(sendCheckIn).mock.calls.at(-1)?.[0];
    expect(lastCall?.lifecycleState).toEqual({ type: "applying" });
  } finally {
    cadence.stop();
  }
});

it("absorbs a burst inside an already-open window and flushes exactly one trailing sync of its final state", async () => {
  vi.useFakeTimers();
  const hub = createStateChangeHub();
  const cadence = startCadence(baseCadenceParams({ subscribeToStateChanges: hub.subscribe }));
  try {
    await cadence.ready;
    expect(sendCheckIn).toHaveBeenCalledTimes(1);

    // Leading edge: opens the window and syncs immediately.
    hub.emit({ type: "downloading", progress: 10 });
    expect(sendCheckIn).toHaveBeenCalledTimes(2);

    // Absorbed into the already-open window -- no call per transition.
    hub.emit({ type: "downloading", progress: 40 });
    hub.emit({ type: "downloading", progress: 90 });
    expect(sendCheckIn).toHaveBeenCalledTimes(2);

    // Still inside the window.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sendCheckIn).toHaveBeenCalledTimes(2);

    // Window closes: exactly one trailing sync, carrying the latest state.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sendCheckIn).toHaveBeenCalledTimes(3);
    const lastCall = vi.mocked(sendCheckIn).mock.calls.at(-1)?.[0];
    expect(lastCall?.lifecycleState).toEqual({ type: "downloading", progress: 90 });

    // Nothing else pending -- no further call once the window has closed.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendCheckIn).toHaveBeenCalledTimes(3);
  } finally {
    cadence.stop();
  }
});

it("skips the trailing sync when checkNow already reported the pending state inside the window", async () => {
  vi.useFakeTimers();
  const hub = createStateChangeHub();
  const cadence = startCadence(baseCadenceParams({ subscribeToStateChanges: hub.subscribe }));
  try {
    await cadence.ready;
    expect(sendCheckIn).toHaveBeenCalledTimes(1);

    // Await the leading sync so the burst tests the debounce window, independently of the in-
    // flight guard.
    await hub.emit({ type: "downloading", progress: 10 });
    expect(sendCheckIn).toHaveBeenCalledTimes(2);

    // Absorbed into the already-open window -- trailing sync now pending.
    hub.emit({ type: "downloading", progress: 90 });
    expect(sendCheckIn).toHaveBeenCalledTimes(2);

    // An unrelated check-now (periodic tick, resume, focus, ...) lands
    // inside the same window and already reports the latest state.
    await cadence.checkNow();
    expect(sendCheckIn).toHaveBeenCalledTimes(3);
    expect(vi.mocked(sendCheckIn).mock.calls.at(-1)?.[0]?.lifecycleState).toEqual({
      type: "downloading",
      progress: 90,
    });

    // Window closes: nothing changed since checkNow's send, so no
    // redundant trailing resend of the identical state.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sendCheckIn).toHaveBeenCalledTimes(3);
  } finally {
    cadence.stop();
  }
});

it("does not resend a transition when its heartbeat finishes after the trailing boundary", async () => {
  vi.useFakeTimers();
  const hub = createStateChangeHub();
  const cadence = startCadence(baseCadenceParams({ subscribeToStateChanges: hub.subscribe }));
  try {
    await cadence.ready;
    await hub.emit({ type: "available" });
    const trailing = hub.emit({ type: "downloading", progress: 90 });
    let release: () => void = () => {
      throw new Error("heartbeat not started");
    };
    vi.mocked(sendCheckIn).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(undefined);
        }),
    );
    const heartbeat = cadence.checkNow();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sendCheckIn).toHaveBeenCalledTimes(3);

    release();
    await heartbeat;
    await trailing;
    expect(sendCheckIn).toHaveBeenCalledTimes(3);
  } finally {
    cadence.stop();
  }
});

it("flushes the trailing state only after five seconds without a reportable transition", async () => {
  vi.useFakeTimers();
  const hub = createStateChangeHub();
  const cadence = startCadence(baseCadenceParams({ subscribeToStateChanges: hub.subscribe }));

  try {
    await cadence.ready;
    await hub.emit({ type: "downloading", progress: 10 });
    await vi.advanceTimersByTimeAsync(4_000);
    const pending = hub.emit({ type: "downloading", progress: 90 });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(sendCheckIn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(sendCheckIn).toHaveBeenCalledTimes(3);
    expect(vi.mocked(sendCheckIn).mock.calls.at(-1)?.[0]?.lifecycleState).toEqual({
      type: "downloading",
      progress: 90,
    });
  } finally {
    cadence.stop();
  }
});

it("never syncs on `checking` and never reports it as the current state", async () => {
  vi.useFakeTimers();
  const hub = createStateChangeHub();
  const cadence = startCadence(baseCadenceParams({ subscribeToStateChanges: hub.subscribe }));
  try {
    await cadence.ready;
    expect(sendCheckIn).toHaveBeenCalledTimes(1);

    hub.emit({ type: "checking" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sendCheckIn).toHaveBeenCalledTimes(1);

    hub.emit({ type: "downloading", progress: 50 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sendCheckIn).toHaveBeenCalledTimes(2);

    // `checking` in between two real states never becomes the reported state.
    hub.emit({ type: "checking" });
    await vi.advanceTimersByTimeAsync(cadence.intervalMs);
    const lastCall = vi.mocked(sendCheckIn).mock.calls.at(-1)?.[0];
    expect(lastCall?.lifecycleState).toEqual({ type: "downloading", progress: 50 });
  } finally {
    cadence.stop();
  }
});

it("a state change after stop() triggers no further check-in", async () => {
  vi.useFakeTimers();
  const hub = createStateChangeHub();
  const cadence = startCadence(baseCadenceParams({ subscribeToStateChanges: hub.subscribe }));
  await cadence.ready;
  expect(sendCheckIn).toHaveBeenCalledTimes(1);

  cadence.stop();
  hub.emit({ type: "downloading", progress: 10 });
  await vi.advanceTimersByTimeAsync(10_000);

  expect(sendCheckIn).toHaveBeenCalledTimes(1);
});

it("a state-triggered sync waits out an in-flight periodic tick rather than being silently dropped", async () => {
  vi.useFakeTimers();
  const hub = createStateChangeHub();
  let resolveFirstSend: (() => void) | undefined;
  vi.mocked(sendCheckIn).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveFirstSend = () => resolve(undefined);
      }),
  );

  const cadence = startCadence(baseCadenceParams({ subscribeToStateChanges: hub.subscribe }));
  try {
    // The initial ready tick is now stalled mid-flight.
    expect(cadence.inFlight).toBe(true);

    // Arrives while that tick is still in flight -- must not be dropped.
    const synced = hub.emit({ type: "applying" });
    expect(sendCheckIn).toHaveBeenCalledTimes(1);

    resolveFirstSend?.();
    await synced;

    expect(sendCheckIn).toHaveBeenCalledTimes(2);
    const lastCall = vi.mocked(sendCheckIn).mock.calls.at(-1)?.[0];
    expect(lastCall?.lifecycleState).toEqual({ type: "applying" });
  } finally {
    cadence.stop();
  }
});
