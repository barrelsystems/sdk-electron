import type { AutoUpdater } from "electron";
import { classifyAndRecordFailure } from "../errorTaxonomy.js";
import type { Phase } from "../models/failure.js";
import { guardAdapterCallback } from "../internalDefects.js";
import { recordLifecycleStateFact } from "../persistence/bufferedFacts.js";
import type { UpdateState } from "../models/state.js";
import type { UpdateFailure, UpdateFailureMode } from "../models/failure.js";
import type { BuiltinOperation, BuiltinUpdaterError } from "./builtinUpdaterErrorMap.js";
import { mapBuiltinUpdaterError } from "./builtinUpdaterErrorMap.js";
import { canStartCheck } from "./updaterAdapter.js";
import type { UpdaterAdapter } from "./updaterAdapter.js";
import { applyAndQuit } from "./applyAndQuit.js";
import { createListenerSet } from "./listenerSet.js";

/** Owns Electron's built-in `autoUpdater` singleton entirely. Never synthesizes a `downloading` state --
 * `update-available` means a download already started silently on macOS, which this must not fake. */
export function createBuiltinUpdaterAdapter(updater: AutoUpdater): UpdaterAdapter {
  let state: UpdateState = { type: "idle" };
  let lastError: UpdateFailure | undefined;
  let targetVersion: string | undefined;
  // Set right before `quitAndInstall()` calls into the platform updater, so
  // an 'error' that fires afterward is classified as a relaunch failure, not
  // a check failure -- cleared once that error is handled either way.
  let awaitingRelaunch = false;
  const stateChangeListeners = createListenerSet<UpdateState>();
  const updateErrorListeners = createListenerSet<UpdateFailure>();

  function setState(newState: UpdateState): Promise<void> {
    state = newState;
    recordLifecycleStateFact(newState);
    return stateChangeListeners.notify(newState);
  }

  function recordFailure(failureMode: UpdateFailureMode, phase: Phase, platformCode: string): void {
    const built = classifyAndRecordFailure("electron-builtin", failureMode, phase, platformCode);
    lastError = built.failure;
    void updateErrorListeners.notify(built.failure);
    void setState(built.state);
  }

  updater.on("checking-for-update", () => {
    guardAdapterCallback("electron-builtin:checking-for-update", () => {
      void setState({ type: "checking" });
    });
  });

  updater.on("update-not-available", () => {
    guardAdapterCallback("electron-builtin:update-not-available", () => {
      targetVersion = undefined;
      void setState({ type: "idle" });
    });
  });

  updater.on("update-available", () => {
    guardAdapterCallback("electron-builtin:update-available", () => {
      void setState({ type: "available" });
    });
  });

  // Electron's own types pass `releaseNotes` as the second positional
  // argument here -- `update-available` carries no such payload, so
  // `available` never gets release notes, only `downloaded` does.
  updater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
    guardAdapterCallback("electron-builtin:update-downloaded", () => {
      targetVersion = releaseName !== "" ? releaseName : undefined;
      void setState({
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
      const platformCode =
        process.platform === "darwin" && error.domain !== undefined && error.code !== undefined
          ? `${error.domain}:${error.code}`
          : error.message;
      recordFailure(failureMode, phase, platformCode);
    });
  });

  return {
    checkForUpdates() {
      if (!canStartCheck(state)) return;

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
      return applyAndQuit(setState, () => {
        try {
          updater.quitAndInstall();
        } catch (error) {
          if (state.type === "failed") return;

          awaitingRelaunch = false;
          targetVersion = undefined;
          const native = error instanceof Error ? error : new Error(String(error));
          const { failureMode, phase } = mapBuiltinUpdaterError(native, "relaunching");
          recordFailure(failureMode, phase, native.message);
        }
      });
    },
    setFeedURL(url) {
      updater.setFeedURL({ url });
    },
    getUpdateState: () => state,
    getLastUpdateError: () => lastError,
    getTargetVersion: () => targetVersion,
    onStateChange: stateChangeListeners.add,
    onUpdateError: updateErrorListeners.add,
  };
}
