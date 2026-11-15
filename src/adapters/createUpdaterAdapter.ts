import { autoUpdater as builtinAutoUpdater } from "electron";
import { createBuiltinUpdaterAdapter } from "./builtinUpdaterAdapter.js";
import type { ElectronUpdaterLike, UpdaterAdapter } from "./electronUpdaterAdapter.js";
import { createElectronUpdaterAdapter } from "./electronUpdaterAdapter.js";

/**
 * `electron-updater` is an optional peer dependency, detected at runtime --
 * presence is the choice. Otherwise Electron's own built-in `autoUpdater`
 * is the free, always-available fallback.
 */
export async function createUpdaterAdapter(): Promise<UpdaterAdapter> {
  try {
    const electronUpdater = (await import("electron-updater")) as {
      autoUpdater: ElectronUpdaterLike;
    };
    return createElectronUpdaterAdapter(electronUpdater.autoUpdater);
  } catch {
    return createBuiltinUpdaterAdapter(builtinAutoUpdater);
  }
}
