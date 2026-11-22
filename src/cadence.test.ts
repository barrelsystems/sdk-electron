import { afterEach, describe, expect, it, vi } from "vitest";
import { policyHoldsTheVendorCheck, startCadence } from "./cadence.js";
import type { Policy } from "./types.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse("2026-01-10T00:00:00.000Z");

describe("policyHoldsTheVendorCheck", () => {
  it("returns false when there is no Policy yet", () => {
    expect(policyHoldsTheVendorCheck(undefined, DAY_MS, NOW)).toBe(false);
  });

  it("returns false for a current Policy", () => {
    const current: Policy = {
      type: "current",
      issuedAt: "2026-01-09T23:00:00.000Z",
      environment: "production",
    };
    expect(policyHoldsTheVendorCheck(current, DAY_MS, NOW)).toBe(false);
  });

  it("returns false for an updateEligible Policy", () => {
    const eligible: Policy = {
      type: "updateEligible",
      issuedAt: "2026-01-09T23:00:00.000Z",
      environment: "production",
    };
    expect(policyHoldsTheVendorCheck(eligible, DAY_MS, NOW)).toBe(false);
  });

  it("returns true for a held Policy issued 1 hour ago, under the default 24h ceiling", () => {
    const held: Policy = {
      type: "held",
      issuedAt: new Date(NOW - HOUR_MS).toISOString(),
      environment: "production",
    };
    expect(policyHoldsTheVendorCheck(held, DAY_MS, NOW)).toBe(true);
  });

  it("fails open once the held Policy's age exceeds holdCacheMaxAge", () => {
    const held: Policy = {
      type: "held",
      issuedAt: new Date(NOW - DAY_MS - HOUR_MS).toISOString(),
      environment: "production",
    };
    expect(policyHoldsTheVendorCheck(held, DAY_MS, NOW)).toBe(false);
  });

  it("fails open once the operator's own `until` has passed, even under holdCacheMaxAge", () => {
    const held: Policy = {
      type: "held",
      issuedAt: new Date(NOW - HOUR_MS).toISOString(),
      environment: "production",
      until: new Date(NOW - 1000).toISOString(),
    };
    expect(policyHoldsTheVendorCheck(held, DAY_MS, NOW)).toBe(false);
  });

  it("still holds when `until` is in the future", () => {
    const held: Policy = {
      type: "held",
      issuedAt: new Date(NOW - HOUR_MS).toISOString(),
      environment: "production",
      until: new Date(NOW + HOUR_MS).toISOString(),
    };
    expect(policyHoldsTheVendorCheck(held, DAY_MS, NOW)).toBe(true);
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

it("keeps the fixed timer anchored across focus and removes lifecycle listeners on stop", async () => {
  vi.useFakeTimers();
  const cadence = startCadence({
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
    getAdapterState: () => ({ type: "idle" }),
    getBufferedFacts: () => [],
    clearBufferedFacts: () => {},
    onPolicyResponse: () => {},
    checkForUpdates: () => {},
    getPolicy: () => undefined,
    holdCacheMaxAge: DAY_MS,
  });
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
