import { createRequire } from "node:module";
import { autoUpdater as builtinAutoUpdater } from "electron";
import { createBuiltinUpdaterAdapter } from "./builtinUpdaterAdapter.js";
import type { ElectronUpdaterLike } from "./electronUpdaterAdapter.js";
import type { UpdaterAdapter } from "./updaterAdapter.js";
import { createElectronUpdaterAdapter } from "./electronUpdaterAdapter.js";

function loadElectronUpdater(): { autoUpdater: ElectronUpdaterLike } {
  // `require`, not a dynamic `import()`: a dynamic `import()` silently
  // resolves `electron-updater`'s getter-based `autoUpdater` export to
  // `undefined`, instead of invoking the getter the way `require` does.
  const electronUpdater = createRequire(import.meta.url)("electron-updater");
  return electronUpdater as { autoUpdater: ElectronUpdaterLike };
}

/** Select the optional updater peer when installed; otherwise use the built-in updater. Tests can inject the loader. */
export function createUpdaterAdapter(
  load: () => { autoUpdater: ElectronUpdaterLike } = loadElectronUpdater,
): UpdaterAdapter {
  try {
    const electronUpdater = load();
    return createElectronUpdaterAdapter(electronUpdater.autoUpdater);
  } catch {
    return createBuiltinUpdaterAdapter(builtinAutoUpdater);
  }
}
