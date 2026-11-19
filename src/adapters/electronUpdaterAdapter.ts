import { app } from "electron";
import { buildFailureState } from "../errorTaxonomy.js";
import { guardAdapterCallback } from "../internalDefects.js";
import { recordAdapterStateFact, recordUpdateErrorFact } from "../persistence/bufferedFacts.js";
import type { AdapterState, UpdateFailure } from "../types.js";
import { mapElectronUpdaterError } from "./electronUpdaterErrorMap.js";
import { createListenerSet } from "./listenerSet.js";

/** A single release note, as electron-updater's own `ReleaseNoteInfo` shapes it. */
export interface UpdaterReleaseNoteInfo {
  version: string;
  note: string | null;
}

/** The slice of electron-updater's real `UpdateInfo` this adapter reads. */
export interface UpdaterUpdateInfo {
  releaseNotes?: string | UpdaterReleaseNoteInfo[] | null;
}

/**
 * The slice of `electron-updater`'s `autoUpdater` this adapter actually
 * uses, hand-written rather than imported from its own types -- those
 * types live behind an optional peer dependency that may not be installed.
 */
export interface ElectronUpdaterLike {
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-not-available", listener: () => void): unknown;
  on(event: "update-available", listener: (info: UpdaterUpdateInfo) => void): unknown;
  on(event: "download-progress", listener: (info: { percent: number }) => void): unknown;
  on(event: "update-downloaded", listener: () => void): unknown;
  on(event: "update-cancelled", listener: () => void): unknown;
  on(event: "error", listener: (error: Error & { code?: string }) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  autoDownload: boolean;
  forceDevUpdateConfig: boolean;
}

export interface UpdaterAdapter {
  checkForUpdates(): void;
  downloadUpdate(): void;
  quitAndInstall(): void;
  /** No-op if the host never configured a feed URL. */
  setFeedURL(url: string): void;
  getAdapterState(): AdapterState;
  getLastUpdateError(): UpdateFailure | undefined;
  /** Multicast: host-control registers its own listener, and the public
   * `onStateChange` export registers the host app's on top of it. */
  onStateChange(listener: (state: AdapterState) => void): void;
}

/**
 * electron-updater's `releaseNotes` is either a plain string or an array of
 * per-version notes (when the update spans more than one release) -- joined
 * here into one string, never fabricated when the library gives nothing.
 */
function normalizeReleaseNotes(
  releaseNotes: UpdaterUpdateInfo["releaseNotes"],
): string | undefined {
  if (typeof releaseNotes === "string") return releaseNotes;
  if (!Array.isArray(releaseNotes)) return undefined;
  const notes = releaseNotes.map((entry) => entry.note).filter((note) => note !== null);
  return notes.length > 0 ? notes.join("\n\n") : undefined;
}

/** Spreads `releaseNotes` onto `base` only when present -- never a `releaseNotes: undefined` key. */
function withReleaseNotes<T extends object>(
  base: T,
  notes: string | undefined,
): T & { releaseNotes?: string } {
  return { ...base, ...(notes !== undefined && { releaseNotes: notes }) };
}

/** Owns `electron-updater`'s singleton entirely -- the host never calls it directly. */
export function createElectronUpdaterAdapter(updater: ElectronUpdaterLike): UpdaterAdapter {
  // Full-wrap: host-control owns every download's timing via its own
  // pre-action-check gate, never electron-updater's own auto-trigger.
  updater.autoDownload = false;

  let state: AdapterState = { type: "idle" };
  let lastError: UpdateFailure | undefined;
  let currentPhase: "check" | "download" | "idle" = "idle";
  let currentReleaseNotes: string | undefined;
  const stateChangeListeners = createListenerSet<AdapterState>();

  function setState(newState: AdapterState): void {
    state = newState;
    recordAdapterStateFact(newState);
    stateChangeListeners.notify(newState);
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
      currentReleaseNotes = undefined;
      setState({ type: "idle" });
    });
  });

  updater.on("update-available", (info) => {
    guardAdapterCallback("electron-updater:update-available", () => {
      currentPhase = "download";
      currentReleaseNotes = normalizeReleaseNotes(info?.releaseNotes);
      setState(withReleaseNotes({ type: "available" }, currentReleaseNotes));
    });
  });

  updater.on("download-progress", (info) => {
    guardAdapterCallback("electron-updater:download-progress", () => {
      setState(
        withReleaseNotes(
          { type: "downloading", progress: Math.round(info.percent) },
          currentReleaseNotes,
        ),
      );
    });
  });

  updater.on("update-downloaded", () => {
    guardAdapterCallback("electron-updater:update-downloaded", () => {
      currentPhase = "idle";
      setState(withReleaseNotes({ type: "downloaded" }, currentReleaseNotes));
    });
  });

  updater.on("update-cancelled", () => {
    guardAdapterCallback("electron-updater:update-cancelled", () => {
      currentPhase = "idle";
      currentReleaseNotes = undefined;
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
      currentReleaseNotes = undefined;
      recordUpdateErrorFact(built.failure);
    });
  });

  return {
    checkForUpdates() {
      updater.checkForUpdates().catch(() => {
        // Already surfaced via the 'error' listener above.
      });
    },
    downloadUpdate() {
      updater.downloadUpdate().catch(() => {
        // Already surfaced via the 'error' listener above.
      });
    },
    quitAndInstall() {
      updater.quitAndInstall();
    },
    setFeedURL(url) {
      // Dev builds are never "packaged," and electron-updater otherwise
      // no-ops rather than hitting the network -- this is the one quirk
      // the host should never have to know about.
      updater.forceDevUpdateConfig = !app.isPackaged;
      updater.setFeedURL({ provider: "generic", url });
    },
    getAdapterState: () => state,
    getLastUpdateError: () => lastError,
    onStateChange: stateChangeListeners.add,
  };
}
