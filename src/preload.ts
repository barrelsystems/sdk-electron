import { contextBridge, ipcRenderer } from "electron";
import type { AdapterState, Policy, UpdateFailure } from "./types.js";

export interface BarrelStatus {
  policy: Policy | undefined;
  lastUpdateError: UpdateFailure | undefined;
  adapterState: AdapterState | undefined;
}

export interface BarrelBridge {
  getStatus(): Promise<BarrelStatus>;
  downloadUpdate(): Promise<void>;
  applyUpdate(): Promise<void>;
}

// A separate entry point, not part of the main one: a preload script
// should never pull in `electron-updater` or any other main-process-only
// code it has no use for.
export function exposeBarrelBridge(): void {
  const bridge: BarrelBridge = {
    getStatus: () => ipcRenderer.invoke("barrel:getStatus"),
    downloadUpdate: () => ipcRenderer.invoke("barrel:downloadUpdate"),
    applyUpdate: () => ipcRenderer.invoke("barrel:applyUpdate"),
  };
  contextBridge.exposeInMainWorld("barrel", bridge);
}
