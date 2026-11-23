import type { Phase } from "../models/failure.js";
import { EventEmitter } from "node:events";
import type { AutoUpdater } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categoryForPhase, resolveFailureTitle } from "../errorTaxonomy.js";
import type { UpdateFailureMode } from "../models/failure.js";
import { createBuiltinUpdaterAdapter } from "./builtinUpdaterAdapter.js";

function createFakeUpdater(): AutoUpdater & EventEmitter {
  const emitter = new EventEmitter() as AutoUpdater & EventEmitter;
  emitter.checkForUpdates = vi.fn();
  emitter.quitAndInstall = vi.fn();
  emitter.setFeedURL = vi.fn();
  return emitter;
}

describe("createBuiltinUpdaterAdapter", () => {
  it("settles a synchronous installer failure without retaining its candidate", async () => {
    const updater = createFakeUpdater();
    updater.quitAndInstall = vi.fn(() => {
      throw new Error("installer failed");
    });
    const adapter = createBuiltinUpdaterAdapter(updater);
    updater.emit("update-downloaded", {}, "notes", "2.0.0", new Date(), "url");

    await adapter.quitAndInstall();

    expect(adapter.getUpdateState().type).toBe("failed");
    expect(adapter.getTargetVersion()).toBeUndefined();
    expect(adapter.getLastUpdateError()).toMatchObject({ phase: "install" });

    updater.emit("error", new Error("check failed"));

    expect(adapter.getLastUpdateError()).toMatchObject({ phase: "check" });
  });

  it("starts idle and reports checking/available/downloaded, with no progress signal", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    expect(adapter.getUpdateState()).toEqual({ type: "idle" });

    updater.emit("checking-for-update");
    expect(adapter.getUpdateState()).toEqual({ type: "checking" });

    updater.emit("update-available");
    expect(adapter.getUpdateState()).toEqual({ type: "available" });

    updater.emit("update-downloaded", {}, "notes", "name", new Date(), "url");
    expect(adapter.getUpdateState()).toEqual({ type: "downloaded", releaseNotes: "notes" });
  });

  it("carries releaseNotes on downloaded, but never on available -- Electron only passes it to update-downloaded", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    updater.emit("update-available");
    expect(adapter.getUpdateState()).toEqual({ type: "available" });
    expect("releaseNotes" in adapter.getUpdateState()).toBe(false);

    updater.emit("update-downloaded", {}, "Fixed a crash on launch.", "name", new Date(), "url");
    expect(adapter.getUpdateState()).toEqual({
      type: "downloaded",
      releaseNotes: "Fixed a crash on launch.",
    });
  });

  it("never fabricates releaseNotes when the platform gives an empty string", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    updater.emit("update-downloaded", {}, "", "name", new Date(), "url");

    expect(adapter.getUpdateState()).toEqual({ type: "downloaded" });
    expect("releaseNotes" in adapter.getUpdateState()).toBe(false);
  });

  it("tracks the downloaded release's name as the apply target version", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    expect(adapter.getTargetVersion()).toBeUndefined();
    updater.emit("update-downloaded", {}, "notes", "2.0.0", new Date(), "url");
    expect(adapter.getTargetVersion()).toBe("2.0.0");
  });

  it("clears the target version once the cycle ends without applying", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    updater.emit("update-downloaded", {}, "notes", "2.0.0", new Date(), "url");
    expect(adapter.getTargetVersion()).toBe("2.0.0");

    updater.emit("error", new Error("boom"));
    expect(adapter.getTargetVersion()).toBeUndefined();
  });

  it("never synthesizes a downloading state, even though macOS has already started downloading by update-available", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    updater.emit("update-available");

    expect(adapter.getUpdateState()).toEqual({ type: "available" });
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

  it("quitAndInstall() delegates to the underlying updater", async () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    await adapter.quitAndInstall();

    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("quitAndInstall() reports `applying` before the underlying updater is called", async () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);
    updater.quitAndInstall = vi.fn(() => {
      expect(adapter.getUpdateState()).toEqual({ type: "applying" });
    });

    await adapter.quitAndInstall();

    expect(adapter.getUpdateState()).toEqual({ type: "applying" });
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
    adapter.onStateChange((state) => {
      states.push(state);
    });

    updater.emit("checking-for-update");
    updater.emit("update-available");

    expect(states).toEqual([{ type: "checking" }, { type: "available" }]);
  });

  it("onStateChange supports more than one listener", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);
    const first: unknown[] = [];
    const second: unknown[] = [];
    adapter.onStateChange((state) => {
      first.push(state);
    });
    adapter.onStateChange((state) => {
      second.push(state);
    });

    updater.emit("checking-for-update");

    expect(first).toEqual([{ type: "checking" }]);
    expect(second).toEqual([{ type: "checking" }]);
  });

  it("onUpdateError notifies its listener once per newly recorded failure", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);
    const failures: unknown[] = [];
    adapter.onUpdateError((failure) => {
      failures.push(failure);
    });

    updater.emit("error", new Error("boom"));

    expect(failures).toHaveLength(1);
    expect(adapter.getLastUpdateError()).toEqual(failures[0]);
  });

  it("onUpdateError never replays a failure that happened before the listener was registered", () => {
    const updater = createFakeUpdater();
    const adapter = createBuiltinUpdaterAdapter(updater);

    updater.emit("error", new Error("boom"));

    const failures: unknown[] = [];
    adapter.onUpdateError((failure) => {
      failures.push(failure);
    });

    expect(failures).toHaveLength(0);
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
      expect(adapter.getUpdateState()).toEqual({
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

    const nativeErrors: Array<[string, number, UpdateFailureMode, Phase]> = [
      ["SQRLCodeSignatureErrorDomain", -1, "signature-invalid", "verify"],
      ["SQRLCodeSignatureErrorDomain", -2, "signature-invalid", "verify"],
      ...[-1, -2, -3, -4, -5, -6, -7, -8].map(
        (code): [string, number, UpdateFailureMode, Phase] => [
          "SQRLInstallerErrorDomain",
          code,
          "install-write-failed",
          "install",
        ],
      ),
      ["SQRLUpdaterErrorDomain", 2, "install-missing-update", "install"],
      ["SQRLUpdaterErrorDomain", 3, "install-write-failed", "install"],
      ["SQRLUpdaterErrorDomain", 4, "signature-invalid", "verify"],
      ...[5, 6, 7].map((code): [string, number, UpdateFailureMode, Phase] => [
        "SQRLUpdaterErrorDomain",
        code,
        "manifest-parse-failed",
        "check",
      ]),
      ["SQRLUpdaterErrorDomain", 8, "translocation-blocked", "check"],
      ["UnrecognizedDomain", 123, "unknown", "check"],
    ];

    it.each(nativeErrors)(
      "preserves native %s/%d in the public error",
      (domain, code, mode, phase) => {
        const updater = createFakeUpdater();
        const adapter = createBuiltinUpdaterAdapter(updater);
        expect(adapter.getLastUpdateError()).toBeUndefined();
        const platformCode = `${domain}:${code}`;

        updater.emit(
          "error",
          Object.assign(new Error("localized native message"), { domain, code }),
        );

        const failure = adapter.getLastUpdateError();
        expect(failure).toEqual({
          phase,
          failureMode: mode,
          title: resolveFailureTitle(mode),
          platform: "electron-builtin",
          platformCode,
        });
        expect(adapter.getUpdateState()).toEqual({
          type: "failed",
          category: categoryForPhase(phase),
          code: mode,
          platformCode,
        });

        updater.emit("update-not-available");
        expect(adapter.getUpdateState()).toEqual({ type: "idle" });
        expect(adapter.getLastUpdateError()).toEqual(failure);
      },
    );

    it("a thrown checkForUpdates() surfaces as config-invalid, not a crash", () => {
      const updater = createFakeUpdater();
      updater.checkForUpdates = vi.fn(() => {
        throw new Error("Update URL is not set");
      });
      const adapter = createBuiltinUpdaterAdapter(updater);

      expect(() => adapter.checkForUpdates()).not.toThrow();
      expect(adapter.getUpdateState()).toEqual({
        type: "failed",
        category: "updater",
        code: "config-invalid",
        platformCode: "Update URL is not set",
      });
    });

    it("an error after quitAndInstall() classifies as a relaunch failure, not a check failure", () => {
      const updater = createFakeUpdater();
      const adapter = createBuiltinUpdaterAdapter(updater);

      adapter.quitAndInstall();
      updater.emit("error", new Error("relaunch failed"));

      expect(adapter.getLastUpdateError()).toMatchObject({
        failureMode: "install-relaunch-failed",
        phase: "install",
      });
    });

    it("an error before quitAndInstall() is ever called still classifies as checking", () => {
      const updater = createFakeUpdater();
      const adapter = createBuiltinUpdaterAdapter(updater);

      updater.emit("error", new Error("check failed"));

      expect(adapter.getLastUpdateError()).toMatchObject({
        failureMode: "unknown",
        phase: "check",
      });
    });

    it("a second error after a relaunch failure classifies as checking again, not another relaunch", () => {
      const updater = createFakeUpdater();
      const adapter = createBuiltinUpdaterAdapter(updater);

      adapter.quitAndInstall();
      updater.emit("error", new Error("relaunch failed"));
      updater.emit("error", new Error("check failed"));

      expect(adapter.getLastUpdateError()).toMatchObject({
        failureMode: "unknown",
        phase: "check",
      });
    });
  });
});
