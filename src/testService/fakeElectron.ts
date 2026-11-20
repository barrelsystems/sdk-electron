import { EventEmitter } from "node:events";
import type { AutoUpdater } from "electron";

// The minimal fake `electron` module's own unit tests already use via
// `vi.mock("electron", () => ({ app: mockApp }))` -- `app.isPackaged` is the
// only member the adapter under test actually reads.
export const app = { isPackaged: false };

/** A real `EventEmitter` patched with the non-event methods a fake
 * adapter object needs -- the shared shape behind every fake in this
 * test service. The caller casts to its own target interface. */
export function createFakeEmitter(methods: Record<string, unknown>): EventEmitter {
  return Object.assign(new EventEmitter(), methods);
}

// `createUpdaterAdapter`'s builtin fallback imports this module's own
// `autoUpdater` directly (unlike `electron-updater`, it's not injectable),
// so the test-service must inject events through this same singleton.
export const autoUpdater = createFakeEmitter({
  checkForUpdates: () => {},
  quitAndInstall: () => {},
  setFeedURL: () => {},
}) as AutoUpdater;
