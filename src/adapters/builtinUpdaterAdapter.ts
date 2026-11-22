import type { AutoUpdater } from "electron";
import { classifyAndRecordFailure } from "../errorTaxonomy.js";
import type { Phase } from "../errorTaxonomy.js";
import { guardAdapterCallback } from "../internalDefects.js";
import { recordAdapterStateFact } from "../persistence/bufferedFacts.js";
import type { AdapterState, UpdateFailure, UpdateFailureMode } from "../types.js";
import type { BuiltinOperation, BuiltinUpdaterError } from "./builtinUpdaterErrorMap.js";
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
  let targetVersion: string | undefined;
  // Set right before `quitAndInstall()` calls into the platform updater, so
  // an 'error' that fires afterward is classified as a relaunch failure, not
  // a check failure -- cleared once that error is handled either way.
  let awaitingRelaunch = false;
  const stateChangeListeners = createListenerSet<AdapterState>();

  function setState(newState: AdapterState): void {
    state = newState;
    recordAdapterStateFact(newState);
    stateChangeListeners.notify(newState);
  }

  function recordFailure(failureMode: UpdateFailureMode, phase: Phase, platformCode: string): void {
    const built = classifyAndRecordFailure("electron-builtin", failureMode, phase, platformCode);
    lastError = built.failure;
    setState(built.state);
  }

  updater.on("checking-for-update", () => {
    guardAdapterCallback("electron-builtin:checking-for-update", () => {
      setState({ type: "checking" });
    });
  });

  updater.on("update-not-available", () => {
    guardAdapterCallback("electron-builtin:update-not-available", () => {
      targetVersion = undefined;
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
  updater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
    guardAdapterCallback("electron-builtin:update-downloaded", () => {
      targetVersion = releaseName !== "" ? releaseName : undefined;
      setState({
        type: "downloaded",
        ...(releaseNotes !== "" && releaseNotes !== undefined && { releaseNotes }),
      });
    });
  });

  updater.on("error", (error: BuiltinUpdaterError) => {
    guardAdapterCallback("electron-builtin:error", () => {
      const operation: BuiltinOperation = awaitingRelaunch ? "relaunching" : "checking";
      awaitingRelaunch = false;
      targetVersion = undefined;
      const { failureMode, phase } = mapBuiltinUpdaterError(error, operation);
      recordFailure(failureMode, phase, error.message);
    });
  });

  return {
    checkForUpdates() {
      // Bounds `awaitingRelaunch`'s lifetime to "until the next check
      // cycle," not just "until the next error" -- a relaunch that never
      // errors must not mislabel some unrelated, later check failure.
      awaitingRelaunch = false;
      try {
        updater.checkForUpdates();
      } catch (error) {
        const builtinError: BuiltinUpdaterError =
          error instanceof Error ? error : new Error(String(error));
        const { failureMode, phase } = mapBuiltinUpdaterError(builtinError, "configuring");
        recordFailure(failureMode, phase, builtinError.message);
      }
    },
    // No lever exists here: `update-available` already means Squirrel.Mac
    // started downloading silently the moment `checkForUpdates()` found
    // something -- there's nothing left to trigger.
    downloadUpdate() {},
    quitAndInstall() {
      awaitingRelaunch = true;
      updater.quitAndInstall();
    },
    setFeedURL(url) {
      updater.setFeedURL({ url });
    },
    getAdapterState: () => state,
    getLastUpdateError: () => lastError,
    getTargetVersion: () => targetVersion,
    onStateChange: stateChangeListeners.add,
  };
}
