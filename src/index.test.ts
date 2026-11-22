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
// src/adapters/*.test.ts) -- this keeps it from exercising real
// electron-updater construction, which needs a real Electron process.
const fakeAdapter = vi.hoisted(() => {
  const listeners: ((state: { type: string }) => void)[] = [];
  return {
    getAdapterState: () => ({ type: "idle" }),
    checkForUpdates: () => {},
    downloadUpdate: () => {},
    quitAndInstall: () => {},
    getLastUpdateError: () => undefined,
    onStateChange: (listener: (state: { type: string }) => void) => {
      listeners.push(listener);
    },
    listenerCount: () => listeners.length,
    emit: (state: { type: string }) => {
      for (const listener of listeners) listener(state);
    },
    reset: () => {
      listeners.length = 0;
    },
  };
});

vi.mock("./adapters/createUpdaterAdapter.js", () => ({
  createUpdaterAdapter: async () => fakeAdapter,
}));

vi.mock("./squirrelStartup.js", () => ({ quitIfSquirrelStartupEvent: () => false }));

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

  it("throws a typed, synchronous error when holdCacheMaxAge exceeds 7 days", async () => {
    const { init } = await import("./index.js");
    const { BarrelConfigError } = await import("./errors.js");
    expect(() => init({ credential: "cred", holdCacheMaxAge: 8 * 24 * 60 * 60 * 1000 })).toThrow(
      BarrelConfigError,
    );
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

  it("getPolicy() returns undefined before any successful check-in", async () => {
    const { getPolicy } = await import("./index.js");
    expect(getPolicy()).toBeUndefined();
  });

  it("getLastUpdateError() falls back to the most recent buffered updateError fact when the adapter has none in memory", async () => {
    const { configureBufferedFacts, recordUpdateErrorFact } =
      await import("./persistence/bufferedFacts.js");
    await configureBufferedFacts(join(userDataDir, "barrel-buffered-facts.json"));
    recordUpdateErrorFact({
      phase: "download",
      failureMode: "download-transport-failed",
      title: "ignored -- never read back from here",
      platform: "electron-updater",
      platformCode: "ENOTFOUND",
    });

    const { getLastUpdateError } = await import("./index.js");

    expect(getLastUpdateError()).toEqual({
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

    const { init, getLastUpdateError } = await import("./index.js");
    init({ credential: "cred" });
    await vi.waitFor(() => expect(fakeAdapter.listenerCount()).toBeGreaterThan(0));

    expect(getLastUpdateError()).toMatchObject({
      phase: "install",
      failureMode: "apply-not-confirmed",
      platform: "version-check",
      platformCode: "expected 2.0.0, running 1.0.0",
    });
  });

  it("a matching expected version clears the marker and records nothing", async () => {
    const expectationPath = join(userDataDir, "barrel-version-expectation.json");
    writeFileSync(expectationPath, JSON.stringify({ expectedVersion: "1.0.0" }));

    const { init, getLastUpdateError } = await import("./index.js");
    init({ credential: "cred" });
    await vi.waitFor(() => expect(fakeAdapter.listenerCount()).toBeGreaterThan(0));

    expect(getLastUpdateError()).toBeUndefined();
    await vi.waitFor(() => {
      expect(JSON.parse(readFileSync(expectationPath, "utf8"))).toEqual({});
    });
  });

  it("applyUpdate() is a safe no-op before init() has resolved", async () => {
    const { applyUpdate } = await import("./index.js");
    expect(() => applyUpdate()).not.toThrow();
  });

  it("onStateChange() queues a listener registered before init() resolves, then attaches it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
    const { init, onStateChange } = await import("./index.js");
    const states: unknown[] = [];
    onStateChange((state) => states.push(state));
    init({ credential: "cred" });

    await vi.waitFor(() => expect(fakeAdapter.listenerCount()).toBeGreaterThan(0));
    fakeAdapter.emit({ type: "checking" });

    expect(states).toEqual([{ type: "checking" }]);
  });

  it("onStateChange() attaches immediately when called after init() has resolved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
    );
    const { init, onStateChange } = await import("./index.js");
    init({ credential: "cred" });
    // host-control's own internal listener attaches once init() resolves --
    // this is the signal that the adapter itself is now ready.
    await vi.waitFor(() => expect(fakeAdapter.listenerCount()).toBeGreaterThan(0));

    const states: unknown[] = [];
    onStateChange((state) => states.push(state));
    fakeAdapter.emit({ type: "available" });

    expect(states).toEqual([{ type: "available" }]);
  });

  // The quit/warn mechanics themselves are squirrelStartup.test.ts's job --
  // this only covers init()'s own contract: it must defer to
  // quitIfSquirrelStartupEvent() and do nothing else once it returns true.
  it("a Squirrel lifecycle event short-circuits init() entirely", async () => {
    vi.doMock("./squirrelStartup.js", () => ({ quitIfSquirrelStartupEvent: () => true }));

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { init } = await import("./index.js");
    init({ credential: "cred" });

    expect(fetchSpy).not.toHaveBeenCalled();

    vi.doUnmock("./squirrelStartup.js");
  });
});
