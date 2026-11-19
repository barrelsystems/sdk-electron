import { ipcMain } from "electron";
import {
  applyUpdate,
  downloadUpdate,
  getAdapterState,
  getLastUpdateError,
  getPolicy,
} from "./index.js";

// The exact shape every real integration needs from its renderer --
// matches `BarrelStatus` in `./preload.ts`, the other half of this bridge.
export function registerIpcHandlers(): void {
  ipcMain.handle("barrel:getStatus", () => ({
    policy: getPolicy(),
    lastUpdateError: getLastUpdateError(),
    adapterState: getAdapterState(),
  }));

  ipcMain.handle("barrel:downloadUpdate", () => {
    downloadUpdate();
  });

  ipcMain.handle("barrel:applyUpdate", () => {
    applyUpdate();
  });
}
