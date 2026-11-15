import { EventEmitter } from "node:events";
import type { AutoUpdater } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBuiltinUpdaterAdapter } from "./builtinUpdaterAdapter.js";

function createFakeUpdater(): AutoUpdater & EventEmitter {
  const emitter = new EventEmitter() as AutoUpdater & EventEmitter;
  emitter.checkForUpdates = vi.fn();
  return emitter;
}

describe("createBuiltinUpdaterAdapter", () => {
  it("starts idle and reports checking/available/downloaded, with no progress signal", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    expect(adapter.getAdapterState()).toEqual({ type: "idle" });

    updater.emit("checking-for-update");
    expect(adapter.getAdapterState()).toEqual({ type: "checking" });

    updater.emit("update-available");
    expect(adapter.getAdapterState()).toEqual({ type: "available" });

    updater.emit("update-downloaded", {}, "notes", "name", new Date(), "url");
    expect(adapter.getAdapterState()).toEqual({ type: "downloaded" });
  });

  it("never synthesizes a downloading state, even though macOS has already started downloading by update-available", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    updater.emit("update-available");

    expect(adapter.getAdapterState()).toEqual({ type: "available" });
  });

  it("checkForUpdates() delegates to the underlying updater on success", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    adapter.checkForUpdates();

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  describe("on Windows, with no library-sourced identifier at all", () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });

    it("maps an error during checkForUpdates to unknown, phase check", () => {
      const updater = createFakeUpdater();
      const adapter = createBuiltinUpdaterAdapter(updater);

      updater.emit("error", new Error("Update URL is not set"));

      expect(adapter.getLastUpdateError()).toMatchObject({
        failureMode: "unknown",
        phase: "check",
        platform: "electron-builtin",
      });
    });

    it("a thrown checkForUpdates() (e.g. no feed URL configured) surfaces as unknown, not config-invalid, not a crash", () => {
      const updater = createFakeUpdater();
      updater.checkForUpdates = vi.fn(() => {
        throw new Error("Update URL is not set");
      });
      const adapter = createBuiltinUpdaterAdapter(updater);

      expect(() => adapter.checkForUpdates()).not.toThrow();
      expect(adapter.getAdapterState()).toEqual({
        type: "failed",
        category: "updater",
        code: "unknown",
        platformCode: "Update URL is not set",
      });
    });
  });

  describe("on macOS, where SetFeedURL misconfiguration is a recognized identifier", () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });

    it("a thrown checkForUpdates() surfaces as config-invalid, not a crash", () => {
      const updater = createFakeUpdater();
      updater.checkForUpdates = vi.fn(() => {
        throw new Error("Update URL is not set");
      });
      const adapter = createBuiltinUpdaterAdapter(updater);

      expect(() => adapter.checkForUpdates()).not.toThrow();
      expect(adapter.getAdapterState()).toEqual({
        type: "failed",
        category: "updater",
        code: "config-invalid",
        platformCode: "Update URL is not set",
      });
    });
  });
});
