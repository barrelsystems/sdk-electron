// No `createRequire(import.meta.url)` fallback here: bundlers hoist and
// rewrite that token when converting this module to CJS, even unreached,
// breaking real builds more often than it helps. Fails open to `false` below.
function noopRequire(): undefined {
  return undefined;
}

/**
 * True when this Windows process is a Squirrel lifecycle event (install,
 * update, uninstall), not a real app launch. Synchronous and `require`d, not
 * dynamically imported, so the decision lands before `init()` returns.
 */
export function isSquirrelStartupEvent(
  // Injectable because the real package transitively requires `electron`
  // itself at load time -- a test must never let that actually happen.
  requireModule: (id: string) => unknown = typeof require === "function" ? require : noopRequire,
): boolean {
  try {
    return Boolean(requireModule("electron-squirrel-startup"));
  } catch {
    return false; // not installed, or not on Windows -- never the host's problem
  }
}

/**
 * Quits for a Squirrel lifecycle event and returns `true` if it did --
 * `app`/`browserWindow` are injected, not imported, so this module still
 * never touches `electron` just by being imported (see `isSquirrelStartupEvent`).
 */
export function quitIfSquirrelStartupEvent(
  app: { quit(): void },
  browserWindow: { getAllWindows(): unknown[] },
  requireModule?: (id: string) => unknown,
): boolean {
  if (!isSquirrelStartupEvent(requireModule)) return false;

  // Always logged, not gated behind `debug`: a window already visibly
  // flashed on screen during what should be a silent lifecycle event.
  if (browserWindow.getAllWindows().length > 0) {
    console.error(
      "[barrel-kit] A window exists during a Squirrel install/update/uninstall event. " +
        "init() must run before any BrowserWindow is created.",
    );
  }
  app.quit();
  return true;
}
