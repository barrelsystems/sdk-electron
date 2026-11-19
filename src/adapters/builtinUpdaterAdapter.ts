import type { AutoUpdater } from "electron";
import { buildFailureState } from "../errorTaxonomy.js";
import { guardAdapterCallback } from "../internalDefects.js";
import { recordAdapterStateFact, recordUpdateErrorFact } from "../persistence/bufferedFacts.js";
import type { AdapterState, UpdateFailure } from "../types.js";
import { mapBuiltinUpdaterError } from "./builtinUpdaterErrorMap.js";
import type { UpdaterAdapter } from "./electronUpdaterAdapter.js";
import { createListenerSet } from "./listenerSet.js";

/**
 * Owns Electron's built-in `autoUpdater` singleton entirely. Never
 * synthesizes a `downloading` state -- `update-available` means a
 * download already started silently on macOS, which this must not fake.
 */
export function createBuiltinUpdaterAdapter(updater: AutoUpdater): UpdaterAdapter {
  let state: AdapterState = { type: "idle" };
  let lastError: UpdateFailure | undefined;
  const stateChangeListeners = createListenerSet<AdapterState>();

  function setState(newState: AdapterState): void {
    state = newState;
    recordAdapterStateFact(newState);
    stateChangeListeners.notify(newState);
  }

  updater.on("checking-for-update", () => {
    guardAdapterCallback("electron-builtin:checking-for-update", () => {
      setState({ type: "checking" });
    });
  });

  updater.on("update-not-available", () => {
    guardAdapterCallback("electron-builtin:update-not-available", () => {
      setState({ type: "idle" });
    });
  });

  updater.on("update-available", () => {
    guardAdapterCallback("electron-builtin:update-available", () => {
      setState({ type: "available" });
    });
  });

  // Electron's own types pass `releaseNotes` as the second positional
  // argument here -- `update-available` carries no such payload, so
  // `available` never gets release notes, only `downloaded` does.
  updater.on("update-downloaded", (_event, releaseNotes) => {
    guardAdapterCallback("electron-builtin:update-downloaded", () => {
      setState({
        type: "downloaded",
        ...(releaseNotes !== "" && releaseNotes !== undefined && { releaseNotes }),
      });
    });
  });

  updater.on("error", (error) => {
    guardAdapterCallback("electron-builtin:error", () => {
      const { failureMode, phase } = mapBuiltinUpdaterError("checking");
      const built = buildFailureState("electron-builtin", failureMode, phase, error.message);
      lastError = built.failure;
      setState(built.state);
      recordUpdateErrorFact(built.failure);
    });
  });

  return {
    checkForUpdates() {
      try {
        updater.checkForUpdates();
      } catch (error) {
        const { failureMode, phase } = mapBuiltinUpdaterError("configuring");
        const platformCode = error instanceof Error ? error.message : String(error);
        const built = buildFailureState("electron-builtin", failureMode, phase, platformCode);
        lastError = built.failure;
        setState(built.state);
        recordUpdateErrorFact(built.failure);
      }
    },
    // No lever exists here: `update-available` already means Squirrel.Mac
    // started downloading silently the moment `checkForUpdates()` found
    // something -- there's nothing left to trigger.
    downloadUpdate() {},
    quitAndInstall() {
      updater.quitAndInstall();
    },
    setFeedURL(url) {
      updater.setFeedURL({ url });
    },
    getAdapterState: () => state,
    getLastUpdateError: () => lastError,
    onStateChange: stateChangeListeners.add,
  };
}
