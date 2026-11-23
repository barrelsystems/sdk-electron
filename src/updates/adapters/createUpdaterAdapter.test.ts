import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("createUpdaterAdapter", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("electron");
  });

  it("wraps electron-updater when it resolves, never touching the built-in fallback", async () => {
    const electronUpdaterCheck = vi.fn().mockResolvedValue(null);
    const builtinCheck = vi.fn();
    vi.doMock("electron", () => ({ autoUpdater: { on: vi.fn(), checkForUpdates: builtinCheck } }));

    const { createUpdaterAdapter } = await import("./createUpdaterAdapter.js");
    // A fake loader, not `vi.doMock("electron-updater", ...)`: the real
    // code reads this module via `require`, which bypasses Vitest's ESM
    // module-registry mocking entirely (see createUpdaterAdapter.ts).
    const adapter = await createUpdaterAdapter(() => ({
      autoUpdater: {
        on: vi.fn(),
        checkForUpdates: electronUpdaterCheck,
        downloadUpdate: vi.fn().mockResolvedValue(null),
        quitAndInstall: vi.fn(),
        setFeedURL: vi.fn(),
        autoDownload: true,
        forceDevUpdateConfig: false,
        isUpdateSupported: vi.fn(),
      },
    }));
    adapter.checkForUpdates();

    expect(electronUpdaterCheck).toHaveBeenCalledTimes(1);
    expect(builtinCheck).not.toHaveBeenCalled();
  });

  it("falls back to the built-in autoUpdater when electron-updater doesn't resolve", async () => {
    const builtinCheck = vi.fn();
    vi.doMock("electron", () => ({ autoUpdater: { on: vi.fn(), checkForUpdates: builtinCheck } }));

    const { createUpdaterAdapter } = await import("./createUpdaterAdapter.js");
    const adapter = await createUpdaterAdapter(() => {
      throw new Error("Cannot find module 'electron-updater'");
    });
    adapter.checkForUpdates();

    expect(builtinCheck).toHaveBeenCalledTimes(1);
  });
});
