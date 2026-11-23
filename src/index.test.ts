import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userDataDir: string;

vi.mock("electron", () => ({
  app: {
    getVersion: () => "1.0.0",
    getPath: () => userDataDir,
    on: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
  powerMonitor: { on: vi.fn() },
}));

// index.test.ts covers init()'s own contract, not updater internals (see
// src/updates/adapters/*.test.ts) -- this keeps it from exercising real
// electron-updater construction, which needs a real Electron process.
const fakeAdapter = vi.hoisted(() => {
  const listeners: ((state: { type: string }) => void)[] = [];
  const errorListeners: ((failure: unknown) => void)[] = [];
  return {
    getUpdateState: () => ({ type: "idle" }),
    checkForUpdates: () => {},
    downloadUpdate: () => {},
    quitAndInstall: () => {},
    getLastUpdateError: () => undefined,
    onStateChange: (listener: (state: { type: string }) => void) => {
      listeners.push(listener);
    },
    onUpdateError: (listener: (failure: unknown) => void) => {
      errorListeners.push(listener);
    },
    listenerCount: () => listeners.length,
    emit: (state: { type: string }) => {
      for (const listener of listeners) listener(state);
    },
    reset: () => {
      listeners.length = 0;
      errorListeners.length = 0;
    },
  };
});

vi.mock("./updates/adapters/createUpdaterAdapter.js", () => ({
  createUpdaterAdapter: async () => fakeAdapter,
}));

vi.mock("./updates/squirrelStartup.js", () => ({ quitIfSquirrelStartupEvent: () => false }));

describe("init", () => {
  beforeEach(() => {
    vi.resetModules();
    fakeAdapter.reset();
    // Keep startup facts buffered until a test explicitly acknowledges a check-in.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    userDataDir = mkdtempSync(join(tmpdir(), "barrel-sdk-userdata-"));
    (process as { type?: string }).type = "browser";
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    delete (process as { type?: string }).type;
  });

  it("captures the channel supplied at init time", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    const { init } = await import("./index.js");
    const config = { credential: "cred", updates: { channel: "beta" } };
    init(config);
    config.updates.channel = "stable";

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error("missing check-in");

    expect(JSON.parse(call[1].body).channel).toBe("beta");
  });

  it.each([undefined, "Beta / Custom"])(
    "reports the configured channel %s on startup",
    async (channel) => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false });
      vi.stubGlobal("fetch", fetchMock);
      const { init } = await import("./index.js");
      init({ credential: "cred", updates: channel === undefined ? {} : { channel } });

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const call = fetchMock.mock.calls[0];
      if (call === undefined) throw new Error("missing check-in");

      expect(JSON.parse(call[1].body).channel).toBe(channel ?? "stable");
    },
  );

  it.each(["download", "apply"] as const)(
    "%s rejects with a typed error before initialization",
    async (action) => {
      const { Updates } = await import("./index.js");

      await expect(Updates[action]()).rejects.toBeInstanceOf(Updates.ActionError);
      await expect(Updates[action]()).rejects.toMatchObject({ code: "notReady" });
    },
  );

  it("is silent (makes no network call) until init() is called", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await import("./index.js"); // importing alone must have no side effects
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws a typed, synchronous error for a blank credential", async () => {
    const { init } = await import("./index.js");
    const { BarrelConfigError } = await import("./errors.js");
    expect(() => init({ credential: "   " })).toThrow(BarrelConfigError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects a non-finite interval synchronously: %s",
    async (checkInIntervalMs) => {
      const { init } = await import("./index.js");
      const { BarrelConfigError } = await import("./errors.js");

      expect(() => init({ credential: "cred", updates: { checkInIntervalMs } })).toThrow(
        BarrelConfigError,
      );
    },
  );

  it("throws a typed, synchronous error when holdCacheMaxAge exceeds 7 days", async () => {
    const { init } = await import("./index.js");
    const { BarrelConfigError } = await import("./errors.js");
    expect(() =>
      init({ credential: "cred", updates: { holdCacheMaxAge: 8 * 24 * 60 * 60 * 1000 } }),
    ).toThrow(BarrelConfigError);
  });

  it("throws a typed, synchronous error when not running in Electron's main process", async () => {
    (process as { type?: string }).type = "renderer";
    const { init } = await import("./index.js");
    const { BarrelConfigError } = await import("./errors.js");
    expect(() => init({ credential: "cred" })).toThrow(BarrelConfigError);
  });

  it("is a silent no-op on a second call — never throws, never reconfigures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
    const { init } = await import("./index.js");
    init({ credential: "cred" });
    expect(() => init({ credential: "cred-2" })).not.toThrow();
    await vi.waitFor(() => expect(fakeAdapter.listenerCount()).toBeGreaterThan(0));
  });

  it("subscription eligibility is undefined before any successful check-in", async () => {
    const { Updates } = await import("./index.js");
    expect(snapshotOf(Updates).eligibility).toBeUndefined();
  });

  it("subscription lastError falls back to the most recent buffered updateError fact when the adapter has none in memory", async () => {
    const { configureBufferedFacts, recordUpdateErrorFact } =
      await import("./updates/persistence/bufferedFacts.js");
    await configureBufferedFacts(join(userDataDir, "barrel-buffered-facts.json"));
    recordUpdateErrorFact({
      phase: "download",
      failureMode: "download-transport-failed",
      title: "ignored -- never read back from here",
      platform: "electron-updater",
      platformCode: "ENOTFOUND",
    });

    const { Updates } = await import("./index.js");

    expect(snapshotOf(Updates).lastError).toEqual({
      phase: "download",
      failureMode: "download-transport-failed",
      title: "The update download failed at the network layer.",
      platform: "electron-updater",
      platformCode: "ENOTFOUND",
    });
  });

  it("a mismatched expected version from the last session records apply-not-confirmed", async () => {
    writeFileSync(
      join(userDataDir, "barrel-version-expectation.json"),
      JSON.stringify({ expectedVersion: "2.0.0" }),
    );

    const { init, Updates } = await import("./index.js");
    init({ credential: "cred" });
    await vi.waitFor(() => expect(fakeAdapter.listenerCount()).toBeGreaterThan(0));

    expect(snapshotOf(Updates).lastError).toMatchObject({
      phase: "install",
      failureMode: "apply-not-confirmed",
      platform: "version-check",
      platformCode: "expected 2.0.0, running 1.0.0",
    });
  });

  it("a matching expected version clears the marker and records nothing", async () => {
    const expectationPath = join(userDataDir, "barrel-version-expectation.json");
    writeFileSync(expectationPath, JSON.stringify({ expectedVersion: "1.0.0" }));

    const { init, Updates } = await import("./index.js");
    init({ credential: "cred" });
    await vi.waitFor(() => expect(fakeAdapter.listenerCount()).toBeGreaterThan(0));

    expect(snapshotOf(Updates).lastError).toBeUndefined();
    await vi.waitFor(() => {
      expect(JSON.parse(readFileSync(expectationPath, "utf8"))).toEqual({});
    });
  });

  it("apply() reports notReady before initialization", async () => {
    const { Updates } = await import("./index.js");
    await expect(Updates.apply()).rejects.toMatchObject({ code: "notReady" });
  });

  it("subscribe() queues a listener registered before init() resolves, then attaches it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
    const { init, Updates } = await import("./index.js");
    const events: unknown[] = [];
    Updates.subscribe((event) => events.push(event));
    init({ credential: "cred" });

    await vi.waitFor(() => expect(fakeAdapter.listenerCount()).toBeGreaterThan(0));
    fakeAdapter.emit({ type: "checking" });

    expect(events).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({
      state: { type: "checking" },
      eligibility: undefined,
      lastError: undefined,
    });
  });

  it("subscribe() attaches immediately when called after init() has resolved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
    const { init, Updates } = await import("./index.js");
    init({ credential: "cred" });
    // host-control's own internal listener attaches once init() resolves --
    // this is the signal that the adapter itself is now ready.
    await vi.waitFor(() => expect(fakeAdapter.listenerCount()).toBeGreaterThan(0));

    const events: unknown[] = [];
    Updates.subscribe((event) => events.push(event));
    fakeAdapter.emit({ type: "available" });

    expect(events).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({
      state: { type: "available" },
      eligibility: undefined,
      lastError: undefined,
    });
  });

  it("subscribe()'s returned subscription stops delivering events once removed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
    const { init, Updates } = await import("./index.js");
    init({ credential: "cred" });
    await vi.waitFor(() => expect(fakeAdapter.listenerCount()).toBeGreaterThan(0));

    const events: unknown[] = [];
    const subscription = Updates.subscribe((event) => events.push(event));
    const remainingEvents: unknown[] = [];
    const remaining = Updates.subscribe((event) => remainingEvents.push(event));
    subscription.remove();
    subscription.remove();
    fakeAdapter.emit({ type: "available" });

    expect(events).toHaveLength(1);
    expect(remainingEvents).toHaveLength(2);
    expect(remainingEvents.at(-1)).toMatchObject({ state: { type: "available" } });
    remaining.remove();
  });

  // The quit/warn mechanics themselves are squirrelStartup.test.ts's job --
  // this only covers init()'s own contract: it must defer to
  // quitIfSquirrelStartupEvent() and do nothing else once it returns true.
  it("a Squirrel lifecycle event short-circuits init() entirely", async () => {
    vi.doMock("./updates/squirrelStartup.js", () => ({ quitIfSquirrelStartupEvent: () => true }));

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { init } = await import("./index.js");
    init({ credential: "cred" });

    expect(fetchSpy).not.toHaveBeenCalled();

    vi.doUnmock("./updates/squirrelStartup.js");
  });
  it("isolates snapshots between subscribers and from runtime state", async () => {
    const { init, Updates } = await import("./index.js");
    init({ credential: "cred" });
    await vi.waitFor(() => expect(fakeAdapter.listenerCount()).toBeGreaterThan(0));
    Updates.subscribe(() => {
      throw new Error("broken observer");
    });
    Updates.subscribe(async () => {
      throw new Error("rejected observer");
    });
    Updates.subscribe((status) => {
      status.state.type = "checking";
    });
    const observed: string[] = [];
    Updates.subscribe((status) => {
      observed.push(status.state.type);
    });

    fakeAdapter.emit({ type: "available" });

    expect(observed.at(-1)).toBe("available");
    expect(snapshotOf(Updates).state.type).toBe("idle");
  });
});

function snapshotOf(
  updates: typeof import("./updates/index.js"),
): import("./updates/models/status.js").Status {
  let snapshot: import("./updates/models/status.js").Status | undefined;
  const subscription = updates.subscribe((status) => {
    snapshot = status;
  });
  subscription.remove();
  if (snapshot === undefined) throw new Error("subscription must deliver its initial snapshot");

  return snapshot;
}
