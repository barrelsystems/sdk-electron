import type { AutoUpdater } from "electron";
import { buildFailureState } from "../errorTaxonomy.js";
import { guardAdapterCallback } from "../internalDefects.js";
import { recordAdapterStateFact, recordUpdateErrorFact } from "../persistence/bufferedFacts.js";
import type { AdapterState, UpdateFailure } from "../types.js";
import { mapBuiltinUpdaterError } from "./builtinUpdaterErrorMap.js";
import type { UpdaterAdapter } from "./electronUpdaterAdapter.js";

/**
 * Owns Electron's built-in `autoUpdater` singleton entirely. Never
 * synthesizes a `downloading` state -- `update-available` means a
 * download already started silently on macOS, which this must not fake.
 */
export function createBuiltinUpdaterAdapter(updater: AutoUpdater): UpdaterAdapter {
  let state: AdapterState = { type: "idle" };
  let lastError: UpdateFailure | undefined;

  function setState(newState: AdapterState): void {
    state = newState;
    recordAdapterStateFact(newState);
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

  updater.on("update-downloaded", () => {
    guardAdapterCallback("electron-builtin:update-downloaded", () => {
      setState({ type: "downloaded" });
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
    getAdapterState: () => state,
    getLastUpdateError: () => lastError,
  };
}
