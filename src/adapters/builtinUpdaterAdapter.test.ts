import { EventEmitter } from "node:events";
import type { AutoUpdater } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBuiltinUpdaterAdapter } from "./builtinUpdaterAdapter.js";

function createFakeUpdater(): AutoUpdater & EventEmitter {
  const emitter = new EventEmitter() as AutoUpdater & EventEmitter;
  emitter.checkForUpdates = vi.fn();
  emitter.quitAndInstall = vi.fn();
  emitter.setFeedURL = vi.fn();
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
    expect(adapter.getAdapterState()).toEqual({ type: "downloaded", releaseNotes: "notes" });
  });

  it("carries releaseNotes on downloaded, but never on available -- Electron only passes it to update-downloaded", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    updater.emit("update-available");
    expect(adapter.getAdapterState()).toEqual({ type: "available" });
    expect("releaseNotes" in adapter.getAdapterState()).toBe(false);

    updater.emit("update-downloaded", {}, "Fixed a crash on launch.", "name", new Date(), "url");
    expect(adapter.getAdapterState()).toEqual({
      type: "downloaded",
      releaseNotes: "Fixed a crash on launch.",
    });
  });

  it("never fabricates releaseNotes when the platform gives an empty string", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    updater.emit("update-downloaded", {}, "", "name", new Date(), "url");

    expect(adapter.getAdapterState()).toEqual({ type: "downloaded" });
    expect("releaseNotes" in adapter.getAdapterState()).toBe(false);
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

  it("downloadUpdate() is a no-op -- update-available already means downloading started", () => {
    const adapter = createBuiltinUpdaterAdapter(createFakeUpdater());
    expect(() => adapter.downloadUpdate()).not.toThrow();
  });

  it("quitAndInstall() delegates to the underlying updater", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    adapter.quitAndInstall();

    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("setFeedURL() passes the URL straight through", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    adapter.setFeedURL("https://updates.example.com/feed.json");

    expect(updater.setFeedURL).toHaveBeenCalledWith({
      url: "https://updates.example.com/feed.json",
    });
  });

  it("onStateChange notifies its listener of every transition", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);
    const states: unknown[] = [];
    adapter.onStateChange((state) => states.push(state));

    updater.emit("checking-for-update");
    updater.emit("update-available");

    expect(states).toEqual([{ type: "checking" }, { type: "available" }]);
  });

  it("onStateChange supports more than one listener", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);
    const first: unknown[] = [];
    const second: unknown[] = [];
    adapter.onStateChange((state) => first.push(state));
    adapter.onStateChange((state) => second.push(state));

    updater.emit("checking-for-update");

    expect(first).toEqual([{ type: "checking" }]);
    expect(second).toEqual([{ type: "checking" }]);
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
