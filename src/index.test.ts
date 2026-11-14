import { mkdtempSync, rmSync } from "node:fs";
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
  powerMonitor: { on: vi.fn() },
}));

describe("init", () => {
  beforeEach(() => {
    vi.resetModules();
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
  });

  it("getPolicy() returns undefined before any successful check-in", async () => {
    const { getPolicy } = await import("./index.js");
    expect(getPolicy()).toBeUndefined();
  });
});
