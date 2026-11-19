import { createRequire } from "node:module";
import { autoUpdater as builtinAutoUpdater } from "electron";
import { createBuiltinUpdaterAdapter } from "./builtinUpdaterAdapter.js";
import type { ElectronUpdaterLike, UpdaterAdapter } from "./electronUpdaterAdapter.js";
import { createElectronUpdaterAdapter } from "./electronUpdaterAdapter.js";

function loadElectronUpdater(): { autoUpdater: ElectronUpdaterLike } {
  // `require`, not a dynamic `import()`: a dynamic `import()` silently
  // resolves `electron-updater`'s getter-based `autoUpdater` export to
  // `undefined`, instead of invoking the getter the way `require` does.
  const electronUpdater = createRequire(import.meta.url)("electron-updater");
  return electronUpdater as { autoUpdater: ElectronUpdaterLike };
}

/**
 * `electron-updater` is an optional peer dependency, detected at runtime --
 * presence is the choice. Otherwise Electron's own built-in `autoUpdater`
 * is the free, always-available fallback.
 */
// `load` is overridable only so tests can inject a fake module without
// touching Node's real resolver.
export async function createUpdaterAdapter(
  load: () => { autoUpdater: ElectronUpdaterLike } = loadElectronUpdater,
): Promise<UpdaterAdapter> {
  try {
    const electronUpdater = load();
    return createElectronUpdaterAdapter(electronUpdater.autoUpdater);
  } catch {
    return createBuiltinUpdaterAdapter(builtinAutoUpdater);
  }
}
