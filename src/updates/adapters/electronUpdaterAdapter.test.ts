import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { release } from "node:os";
import {
  createElectronUpdaterAdapter,
  type ElectronUpdaterLike,
} from "./electronUpdaterAdapter.js";

const mockApp = vi.hoisted(() => ({ isPackaged: false }));
vi.mock("electron", () => ({ app: mockApp }));
vi.mock("node:os", () => ({ release: vi.fn() }));

function createFakeUpdater(): ElectronUpdaterLike & EventEmitter {
  const emitter = new EventEmitter() as ElectronUpdaterLike & EventEmitter;
  emitter.checkForUpdates = vi.fn().mockResolvedValue(null);
  emitter.downloadUpdate = vi.fn().mockResolvedValue(null);
  emitter.quitAndInstall = vi.fn();
  emitter.setFeedURL = vi.fn();
  emitter.autoDownload = true;
  emitter.forceDevUpdateConfig = false;
  return emitter;
}

describe("createElectronUpdaterAdapter", () => {
  it("starts idle and reports checking/available/downloading/downloaded in sequence", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    expect(adapter.getUpdateState()).toEqual({ type: "idle" });

    updater.emit("checking-for-update");
    expect(adapter.getUpdateState()).toEqual({ type: "checking" });

    updater.emit("update-available");
    expect(adapter.getUpdateState()).toEqual({ type: "available" });

    updater.emit("download-progress", { percent: 42.6 });
    expect(adapter.getUpdateState()).toEqual({ type: "downloading", progress: 43 });

    updater.emit("update-downloaded");
    expect(adapter.getUpdateState()).toEqual({ type: "downloaded" });
  });

  it("reports update-not-available as idle", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("checking-for-update");
    updater.emit("update-not-available");

    expect(adapter.getUpdateState()).toEqual({ type: "idle" });
  });

  it("passes through a plain-string releaseNotes and carries it into downloading/downloaded", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("update-available", { releaseNotes: "Fixed a crash on launch." });
    expect(adapter.getUpdateState()).toEqual({
      type: "available",
      releaseNotes: "Fixed a crash on launch.",
    });

    updater.emit("download-progress", { percent: 10 });
    expect(adapter.getUpdateState()).toEqual({
      type: "downloading",
      progress: 10,
      releaseNotes: "Fixed a crash on launch.",
    });

    updater.emit("update-downloaded");
    expect(adapter.getUpdateState()).toEqual({
      type: "downloaded",
      releaseNotes: "Fixed a crash on launch.",
    });
  });

  it("joins a per-version releaseNotes array into one string", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("update-available", {
      releaseNotes: [
        { version: "1.2.0", note: "Added dark mode." },
        { version: "1.1.0", note: "Fixed a crash on launch." },
      ],
    });

    expect(adapter.getUpdateState()).toEqual({
      type: "available",
      releaseNotes: "Added dark mode.\n\nFixed a crash on launch.",
    });
  });

  it("never fabricates releaseNotes when electron-updater gives none", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("update-available");
    expect(adapter.getUpdateState()).toEqual({ type: "available" });
    expect("releaseNotes" in adapter.getUpdateState()).toBe(false);

    updater.emit("update-available", { releaseNotes: null });
    expect(adapter.getUpdateState()).toEqual({ type: "available" });
  });

  it("clears releaseNotes once the update cycle ends (cancelled, idle, or error)", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("update-available", { releaseNotes: "Stale notes." });
    updater.emit("update-cancelled");
    expect(adapter.getUpdateState()).toEqual({ type: "update-cancelled" });

    updater.emit("update-available", { releaseNotes: "Stale notes." });
    updater.emit("update-not-available");
    expect(adapter.getUpdateState()).toEqual({ type: "idle" });

    updater.emit("update-available", { releaseNotes: "Stale notes." });
    updater.emit("error", new Error("boom"));
    updater.emit("checking-for-update");
    expect(adapter.getUpdateState()).toEqual({ type: "checking" });
  });

  it("reports update-cancelled as its own distinct state, never idle", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("checking-for-update");
    updater.emit("update-available");
    updater.emit("update-cancelled");

    expect(adapter.getUpdateState()).toEqual({ type: "update-cancelled" });
  });

  it("maps a signature error during a download to the correct failure, with category derived from phase", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    const error = Object.assign(new Error("manifest not signed"), {
      code: "ERR_UPDATER_MANIFEST_NOT_SIGNED",
    });
    updater.emit("error", error);

    expect(adapter.getUpdateState()).toEqual({
      type: "failed",
      category: "download",
      code: "signature-missing",
      platformCode: "ERR_UPDATER_MANIFEST_NOT_SIGNED",
    });
    expect(adapter.getLastUpdateError()).toEqual({
      phase: "verify",
      failureMode: "signature-missing",
      title: "The update manifest has no signature.",
      platform: "electron-updater",
      platformCode: "ERR_UPDATER_MANIFEST_NOT_SIGNED",
    });
  });

  it("maps HTTP_ERROR_404 to manifest-unreachable only while a check is in flight", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("checking-for-update");
    updater.emit("error", Object.assign(new Error("not found"), { code: "HTTP_ERROR_404" }));

    expect(adapter.getLastUpdateError()).toMatchObject({ failureMode: "manifest-unreachable" });
  });

  it("maps HTTP_ERROR_404 to a generic transport failure outside a check", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("error", Object.assign(new Error("not found"), { code: "HTTP_ERROR_404" }));

    expect(adapter.getLastUpdateError()).toMatchObject({
      failureMode: "download-transport-failed",
    });
  });

  it("falls back to unknown for an unmapped code, carrying it as platformCode", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("error", Object.assign(new Error("something new"), { code: "ERR_SOMETHING_NEW" }));

    expect(adapter.getLastUpdateError()).toMatchObject({
      failureMode: "unknown",
      platformCode: "ERR_SOMETHING_NEW",
    });
  });

  it("preserves the native name of an authorization error that has no code", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);
    const error = Object.assign(new Error("localized authorization message"), {
      name: "ElevationDeniedError",
    });

    updater.emit("error", error);

    expect(adapter.getLastUpdateError()).toMatchObject({
      failureMode: "install-auth-required-or-failed",
      phase: "install",
      platform: "electron-updater",
      platformCode: "ElevationDeniedError",
    });
  });

  it("getLastUpdateError returns undefined until something has actually failed", () => {
    const adapter = createElectronUpdaterAdapter(createFakeUpdater());
    expect(adapter.getLastUpdateError()).toBeUndefined();
  });

  it("checkForUpdates() delegates to the underlying updater and swallows its rejection", async () => {
    const updater = createFakeUpdater();
    updater.checkForUpdates = vi.fn().mockRejectedValue(new Error("boom"));
    const adapter = createElectronUpdaterAdapter(updater);

    expect(() => adapter.checkForUpdates()).not.toThrow();
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledTimes(1));
  });

  it("a bug in the adapter's own event handling never escapes or crashes the listener", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);
    // An unexpected shape (no code/message) must not throw out of the emitter.
    expect(() => updater.emit("download-progress", null as never)).not.toThrow();
    expect(adapter.getUpdateState()).toEqual({ type: "idle" });
  });

  it("forces electron-updater's own autoDownload off -- host-control owns download timing", () => {
    const updater = createFakeUpdater();
    createElectronUpdaterAdapter(updater);

    expect(updater.autoDownload).toBe(false);
  });

  it("downloadUpdate() delegates to the underlying updater and swallows its rejection", async () => {
    const updater = createFakeUpdater();
    updater.downloadUpdate = vi.fn().mockRejectedValue(new Error("boom"));
    const adapter = createElectronUpdaterAdapter(updater);

    expect(() => adapter.downloadUpdate()).not.toThrow();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(1));
  });

  it("quitAndInstall() delegates to the underlying updater", async () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    await adapter.quitAndInstall();

    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("quitAndInstall() reports `applying` before the underlying updater is called", async () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);
    updater.quitAndInstall = vi.fn(() => {
      expect(adapter.getUpdateState()).toEqual({ type: "applying" });
    });

    await adapter.quitAndInstall();

    expect(adapter.getUpdateState()).toEqual({ type: "applying" });
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("setFeedURL() configures the generic provider and forces dev config when unpackaged", () => {
    mockApp.isPackaged = false;
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    adapter.setFeedURL("https://updates.example.com/latest.json");

    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: "https://updates.example.com/latest.json",
    });
    expect(updater.forceDevUpdateConfig).toBe(true);
  });

  it("setFeedURL() never forces dev config on a packaged build", () => {
    mockApp.isPackaged = true;
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    adapter.setFeedURL("https://updates.example.com/latest.json");

    expect(updater.forceDevUpdateConfig).toBe(false);
  });

  it("onStateChange notifies its listener of every transition", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);
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
    const adapter = createElectronUpdaterAdapter(updater);
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
    const adapter = createElectronUpdaterAdapter(updater);
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
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("error", new Error("boom"));

    const failures: unknown[] = [];
    adapter.onUpdateError((failure) => {
      failures.push(failure);
    });

    expect(failures).toHaveLength(0);
  });

  it("reports platform-unsupported, not idle, when a real update exceeds the host's OS version", () => {
    vi.mocked(release).mockReturnValue("19.0.0");
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    const supported = updater.isUpdateSupported({
      version: "2.0.0",
      minimumSystemVersion: "20.0.0",
    });

    expect(supported).toBe(false);
    expect(adapter.getUpdateState()).toEqual({
      type: "failed",
      category: "updater",
      code: "platform-unsupported",
      platformCode: "isUpdateSupported:minimumSystemVersion",
    });
    expect(adapter.getLastUpdateError()).toMatchObject({
      phase: "config",
      failureMode: "platform-unsupported",
    });
  });

  it("supports the update when the host OS satisfies minimumSystemVersion", () => {
    vi.mocked(release).mockReturnValue("21.0.0");
    const updater = createFakeUpdater();
    createElectronUpdaterAdapter(updater);

    expect(updater.isUpdateSupported({ version: "2.0.0", minimumSystemVersion: "20.0.0" })).toBe(
      true,
    );
  });

  it("supports the update when the release declares no minimumSystemVersion", () => {
    const updater = createFakeUpdater();
    createElectronUpdaterAdapter(updater);

    expect(updater.isUpdateSupported({ version: "2.0.0" })).toBe(true);
  });

  it("fails open, like electron-updater's own default, when minimumSystemVersion isn't parseable", () => {
    vi.mocked(release).mockReturnValue("19.0.0");
    const updater = createFakeUpdater();
    createElectronUpdaterAdapter(updater);

    expect(
      updater.isUpdateSupported({ version: "2.0.0", minimumSystemVersion: "not-a-version" }),
    ).toBe(true);
  });

  it("a bug in isUpdateSupported's own logic never escapes or crashes electron-updater's call", () => {
    const updater = createFakeUpdater();
    createElectronUpdaterAdapter(updater);

    expect(updater.isUpdateSupported(null as never)).toBe(true);
  });

  it("does not replace a verified candidate while waiting to apply it", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);
    updater.emit("update-available", { version: "2.0.0" });
    updater.emit("update-downloaded");

    adapter.checkForUpdates();

    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(adapter.getTargetVersion()).toBe("2.0.0");
    expect(adapter.getUpdateState().type).toBe("downloaded");
  });

  it("turns a rejection without a native error event into a terminal failure", async () => {
    const updater = createFakeUpdater();
    updater.downloadUpdate = vi.fn().mockRejectedValue(new Error("native transport"));
    const adapter = createElectronUpdaterAdapter(updater);
    updater.emit("update-available", { version: "2.0.0" });

    adapter.downloadUpdate();

    await vi.waitFor(() => expect(adapter.getUpdateState().type).toBe("failed"));
    expect(adapter.getLastUpdateError()?.platformCode).toBe("native transport");
  });

  it("classifies a synchronous installer throw instead of reporting successful handoff", async () => {
    const updater = createFakeUpdater();
    updater.quitAndInstall = vi.fn(() => {
      throw new Error("native installer");
    });
    const adapter = createElectronUpdaterAdapter(updater);
    updater.emit("update-downloaded");

    await adapter.quitAndInstall();

    expect(adapter.getUpdateState().type).toBe("failed");
    expect(adapter.getLastUpdateError()?.platformCode).toBe("native installer");
  });
});
