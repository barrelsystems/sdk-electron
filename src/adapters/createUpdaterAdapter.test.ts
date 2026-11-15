import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createUpdaterAdapter", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("electron");
    vi.doUnmock("electron-updater");
  });

  it("wraps electron-updater when it resolves, never touching the built-in fallback", async () => {
    const electronUpdaterCheck = vi.fn().mockResolvedValue(null);
    const builtinCheck = vi.fn();
    vi.doMock("electron", () => ({ autoUpdater: { on: vi.fn(), checkForUpdates: builtinCheck } }));
    vi.doMock("electron-updater", () => ({
      autoUpdater: { on: vi.fn(), checkForUpdates: electronUpdaterCheck },
    }));

    const { createUpdaterAdapter } = await import("./createUpdaterAdapter.js");
    const adapter = await createUpdaterAdapter();
    adapter.checkForUpdates();

    expect(electronUpdaterCheck).toHaveBeenCalledTimes(1);
    expect(builtinCheck).not.toHaveBeenCalled();
  });

  it("falls back to the built-in autoUpdater when electron-updater doesn't resolve", async () => {
    const builtinCheck = vi.fn();
    vi.doMock("electron", () => ({ autoUpdater: { on: vi.fn(), checkForUpdates: builtinCheck } }));
    vi.doMock("electron-updater", () => {
      throw new Error("Cannot find module 'electron-updater'");
    });

    const { createUpdaterAdapter } = await import("./createUpdaterAdapter.js");
    const adapter = await createUpdaterAdapter();
    adapter.checkForUpdates();

    expect(builtinCheck).toHaveBeenCalledTimes(1);
  });
});
