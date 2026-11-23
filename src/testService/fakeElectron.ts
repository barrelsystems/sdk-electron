import { EventEmitter } from "node:events";
import type { AutoUpdater } from "electron";

export const activity = { checks: 0, downloads: 0, applies: 0 };
let available = false;

export const app = Object.assign(new EventEmitter(), {
  isPackaged: false,
  getVersion: () => "1.0.0",
  getPath: () => process.env["BARREL_TEST_DATA_DIR"] ?? "",
  getName: () => "TestService",
  quit: () => {},
});

export const powerMonitor = new EventEmitter();
export const BrowserWindow = { getAllWindows: () => [] };

export function createFakeEmitter(methods: Record<string, unknown>): EventEmitter {
  return Object.assign(new EventEmitter(), methods);
}

export const autoUpdater = createFakeEmitter({
  checkForUpdates() {
    activity.checks++;
    autoUpdater.emit("checking-for-update");
    if (available) autoUpdater.emit("update-available", { version: "2.0.0" });
    else autoUpdater.emit("update-not-available");
    return Promise.resolve();
  },
  downloadUpdate() {
    activity.downloads++;
    autoUpdater.emit("update-downloaded");
    return Promise.resolve();
  },
  quitAndInstall() {
    activity.applies++;
  },
  setFeedURL: () => {},
  autoDownload: false,
  forceDevUpdateConfig: false,
}) as AutoUpdater;

Object.assign(globalThis, { __barrelTestAutoUpdater: autoUpdater });

export function prepareAction(stage: "pre-download" | "pre-apply"): void {
  available = true;
  autoUpdater.emit("update-available", { version: "2.0.0" });
  if (stage === "pre-apply") autoUpdater.emit("update-downloaded");
}
