import { buildFailureState } from "../errorTaxonomy.js";
import { guardAdapterCallback } from "../internalDefects.js";
import { recordAdapterStateFact, recordUpdateErrorFact } from "../persistence/bufferedFacts.js";
import type { AdapterState, UpdateFailure } from "../types.js";
import { mapElectronUpdaterError } from "./electronUpdaterErrorMap.js";

/**
 * The slice of `electron-updater`'s `autoUpdater` this adapter actually
 * uses, hand-written rather than imported from its own types -- those
 * types live behind an optional peer dependency that may not be installed.
 */
export interface ElectronUpdaterLike {
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-not-available", listener: () => void): unknown;
  on(event: "update-available", listener: () => void): unknown;
  on(event: "download-progress", listener: (info: { percent: number }) => void): unknown;
  on(event: "update-downloaded", listener: () => void): unknown;
  on(event: "update-cancelled", listener: () => void): unknown;
  on(event: "error", listener: (error: Error & { code?: string }) => void): unknown;
  checkForUpdates(): Promise<unknown>;
}

export interface UpdaterAdapter {
  checkForUpdates(): void;
  getAdapterState(): AdapterState;
  getLastUpdateError(): UpdateFailure | undefined;
}

/** Owns `electron-updater`'s singleton entirely -- the host never calls it directly. */
export function createElectronUpdaterAdapter(updater: ElectronUpdaterLike): UpdaterAdapter {
  let state: AdapterState = { type: "idle" };
  let lastError: UpdateFailure | undefined;
  let currentPhase: "check" | "download" | "idle" = "idle";

  function setState(newState: AdapterState): void {
    state = newState;
    recordAdapterStateFact(newState);
  }

  updater.on("checking-for-update", () => {
    guardAdapterCallback("electron-updater:checking-for-update", () => {
      currentPhase = "check";
      setState({ type: "checking" });
    });
  });

  updater.on("update-not-available", () => {
    guardAdapterCallback("electron-updater:update-not-available", () => {
      currentPhase = "idle";
      setState({ type: "idle" });
    });
  });

  updater.on("update-available", () => {
    guardAdapterCallback("electron-updater:update-available", () => {
      currentPhase = "download";
      setState({ type: "available" });
    });
  });

  updater.on("download-progress", (info) => {
    guardAdapterCallback("electron-updater:download-progress", () => {
      setState({ type: "downloading", progress: Math.round(info.percent) });
    });
  });

  updater.on("update-downloaded", () => {
    guardAdapterCallback("electron-updater:update-downloaded", () => {
      currentPhase = "idle";
      setState({ type: "downloaded" });
    });
  });

  updater.on("update-cancelled", () => {
    guardAdapterCallback("electron-updater:update-cancelled", () => {
      currentPhase = "idle";
      setState({ type: "update-cancelled" });
    });
  });

  updater.on("error", (error) => {
    guardAdapterCallback("electron-updater:error", () => {
      const { failureMode, phase } = mapElectronUpdaterError(error, currentPhase);
      const platformCode = error.code ?? error.message;
      const built = buildFailureState("electron-updater", failureMode, phase, platformCode);
      lastError = built.failure;
      setState(built.state);
      currentPhase = "idle";
      recordUpdateErrorFact(built.failure);
    });
  });

  return {
    checkForUpdates() {
      updater.checkForUpdates().catch(() => {
        // Already surfaced via the 'error' listener above.
      });
    },
    getAdapterState: () => state,
    getLastUpdateError: () => lastError,
  };
}
