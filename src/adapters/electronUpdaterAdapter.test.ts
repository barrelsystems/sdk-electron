import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createElectronUpdaterAdapter,
  type ElectronUpdaterLike,
} from "./electronUpdaterAdapter.js";

function createFakeUpdater(): ElectronUpdaterLike & EventEmitter {
  const emitter = new EventEmitter() as ElectronUpdaterLike & EventEmitter;
  emitter.checkForUpdates = vi.fn().mockResolvedValue(null);
  return emitter;
}

describe("createElectronUpdaterAdapter", () => {
  it("starts idle and reports checking/available/downloading/downloaded in sequence", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    expect(adapter.getAdapterState()).toEqual({ type: "idle" });

    updater.emit("checking-for-update");
    expect(adapter.getAdapterState()).toEqual({ type: "checking" });

    updater.emit("update-available");
    expect(adapter.getAdapterState()).toEqual({ type: "available" });

    updater.emit("download-progress", { percent: 42.6 });
    expect(adapter.getAdapterState()).toEqual({ type: "downloading", progress: 43 });

    updater.emit("update-downloaded");
    expect(adapter.getAdapterState()).toEqual({ type: "downloaded" });
  });

  it("reports update-not-available as idle", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("checking-for-update");
    updater.emit("update-not-available");

    expect(adapter.getAdapterState()).toEqual({ type: "idle" });
  });

  it("reports update-cancelled as its own distinct state, never idle", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    updater.emit("checking-for-update");
    updater.emit("update-available");
    updater.emit("update-cancelled");

    expect(adapter.getAdapterState()).toEqual({ type: "update-cancelled" });
  });

  it("maps a signature error during a download to the correct failure, with category derived from phase", () => {
    const updater = createFakeUpdater();
    const adapter = createElectronUpdaterAdapter(updater);

    const error = Object.assign(new Error("manifest not signed"), {
      code: "ERR_UPDATER_MANIFEST_NOT_SIGNED",
    });
    updater.emit("error", error);

    expect(adapter.getAdapterState()).toEqual({
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
    expect(adapter.getAdapterState()).toEqual({ type: "idle" });
  });
});
