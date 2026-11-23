import { app } from "electron";
import { release } from "node:os";
import { classifyAndRecordFailure } from "../errorTaxonomy.js";
import { guardAdapterCallback, recordInternalDefect } from "../internalDefects.js";
import { recordLifecycleStateFact } from "../persistence/bufferedFacts.js";
import type { UpdateState } from "../models/state.js";
import type { UpdateFailure } from "../models/failure.js";
import { mapElectronUpdaterError } from "./electronUpdaterErrorMap.js";
import { canStartCheck } from "./updaterAdapter.js";
import type { UpdaterAdapter } from "./updaterAdapter.js";
import { applyAndQuit } from "./applyAndQuit.js";
import { createListenerSet } from "./listenerSet.js";

/** A single release note, as electron-updater's own `ReleaseNoteInfo` shapes it. */
interface UpdaterReleaseNoteInfo {
  version: string;
  note: string | null;
}

/** The slice of electron-updater's real `UpdateInfo` this adapter reads. */
interface UpdaterUpdateInfo {
  version: string;
  releaseNotes?: string | UpdaterReleaseNoteInfo[] | null;
  minimumSystemVersion?: string;
}

/** The slice of `electron-updater`'s `autoUpdater` this adapter actually uses, hand-written rather than
 * imported from its own types -- those types live behind an optional peer dependency that may not be
 * installed. */
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
  isUpdateSupported: (updateInfo: UpdaterUpdateInfo) => boolean | Promise<boolean>;
}

/** electron-updater's `releaseNotes` is either a plain string or an array of per-version notes (when the
 * update spans more than one release) -- joined here into one string, never fabricated when the library
 * gives nothing. */
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

/** Compares dotted numeric OS version strings (`os.release()`,
 * `minimumSystemVersion`) -- not general semver, since that's all either
 * one ever is. `null` when either side isn't purely numeric. */
function compareOsVersions(a: string, b: string): number | null {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  if (aParts.some(Number.isNaN) || bParts.some(Number.isNaN)) return null;
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Owns `electron-updater`'s singleton entirely -- the host never calls it directly. */
export function createElectronUpdaterAdapter(updater: ElectronUpdaterLike): UpdaterAdapter {
  // Full-wrap: host-control owns every download's timing via its own
  // pre-action-check gate, never electron-updater's own auto-trigger.
  updater.autoDownload = false;

  let state: UpdateState = { type: "idle" };
  let lastError: UpdateFailure | undefined;
  let failureRevision = 0;
  let currentPhase: "check" | "download" | "idle" = "idle";
  let currentReleaseNotes: string | undefined;
  let targetVersion: string | undefined;
  const stateChangeListeners = createListenerSet<UpdateState>();
  const updateErrorListeners = createListenerSet<UpdateFailure>();

  function setState(newState: UpdateState): Promise<void> {
    state = newState;
    recordLifecycleStateFact(newState);
    return stateChangeListeners.notify(newState);
  }

  // The one place `lastError` is ever assigned -- every failure site below
  // reports through here, so a listener added after setup never misses one
  // and never replays one it already saw.
  function recordFailure(failure: UpdateFailure): void {
    lastError = failure;
    failureRevision++;
    void updateErrorListeners.notify(failure);
  }

  // Mirrors electron-updater's own default `checkIfUpdateSupported` -- the
  // only behavioral difference is reporting this host's disqualification
  // instead of collapsing silently into `update-not-available`.
  updater.isUpdateSupported = (updateInfo) => {
    try {
      const minimumSystemVersion = updateInfo.minimumSystemVersion;
      if (minimumSystemVersion === undefined) return true;
      const comparison = compareOsVersions(release(), minimumSystemVersion);
      // electron-updater's own default fails open on an unparseable version too.
      if (comparison === null || comparison >= 0) return true;
      const built = classifyAndRecordFailure(
        "electron-updater",
        "platform-unsupported",
        "config",
        "isUpdateSupported:minimumSystemVersion",
      );
      recordFailure(built.failure);
      void setState(built.state);
      return false;
    } catch {
      // Every sibling integration point here uses guardAdapterCallback,
      // which can't apply to a value-returning callback -- this is the
      // fail-open equivalent for this one.
      recordInternalDefect("electron-updater:isUpdateSupported");
      return true;
    }
  };

  updater.on("checking-for-update", () => {
    guardAdapterCallback("electron-updater:checking-for-update", () => {
      currentPhase = "check";
      void setState({ type: "checking" });
    });
  });

  updater.on("update-not-available", () => {
    guardAdapterCallback("electron-updater:update-not-available", () => {
      currentPhase = "idle";
      currentReleaseNotes = undefined;
      targetVersion = undefined;
      void setState({ type: "idle" });
    });
  });

  updater.on("update-available", (info) => {
    guardAdapterCallback("electron-updater:update-available", () => {
      currentPhase = "download";
      currentReleaseNotes = normalizeReleaseNotes(info?.releaseNotes);
      targetVersion = info?.version;
      void setState(withReleaseNotes({ type: "available" }, currentReleaseNotes));
    });
  });

  updater.on("download-progress", (info) => {
    guardAdapterCallback("electron-updater:download-progress", () => {
      void setState(
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
      void setState(withReleaseNotes({ type: "downloaded" }, currentReleaseNotes));
    });
  });

  updater.on("update-cancelled", () => {
    guardAdapterCallback("electron-updater:update-cancelled", () => {
      currentPhase = "idle";
      currentReleaseNotes = undefined;
      targetVersion = undefined;
      void setState({ type: "update-cancelled" });
    });
  });

  function handleNativeError(value: unknown): void {
    const error = value instanceof Error ? value : new Error(String(value));
    const native = error as Error & { code?: string };
    const { failureMode, phase } = mapElectronUpdaterError(native, currentPhase);
    const platformCode =
      native.code ?? (native.name === "ElevationDeniedError" ? native.name : native.message);
    const built = classifyAndRecordFailure("electron-updater", failureMode, phase, platformCode);
    recordFailure(built.failure);
    void setState(built.state);
    currentPhase = "idle";
    currentReleaseNotes = undefined;
    targetVersion = undefined;
  }

  updater.on("error", (error) => {
    guardAdapterCallback("electron-updater:error", () => handleNativeError(error));
  });

  function requestNative(operation: () => Promise<unknown>): void {
    const previousFailure = failureRevision;

    function failed(error: unknown): void {
      // Native libraries may both emit and reject for the same failure.
      if (failureRevision === previousFailure && state.type !== "update-cancelled")
        handleNativeError(error);
    }

    try {
      void operation().catch(failed);
    } catch (error) {
      failed(error);
    }
  }

  return {
    checkForUpdates() {
      if (!canStartCheck(state)) return;

      currentPhase = "check";
      requestNative(() => updater.checkForUpdates());
    },
    downloadUpdate() {
      currentPhase = "download";
      requestNative(() => updater.downloadUpdate());
    },
    quitAndInstall: () =>
      applyAndQuit(setState, () => {
        try {
          updater.quitAndInstall();
        } catch (error) {
          handleNativeError(error);
        }
      }),
    setFeedURL(url) {
      // Dev builds are never "packaged," and electron-updater otherwise
      // no-ops rather than hitting the network -- this is the one quirk
      // the host should never have to know about.
      updater.forceDevUpdateConfig = !app.isPackaged;
      updater.setFeedURL({ provider: "generic", url });
    },
    getUpdateState: () => state,
    getLastUpdateError: () => lastError,
    getTargetVersion: () => targetVersion,
    onStateChange: stateChangeListeners.add,
    onUpdateError: updateErrorListeners.add,
  };
}
