import type { UpdateFailure } from "../models/failure.js";
import type { UpdateState } from "../models/state.js";

/** Whether a new check can start from this state -- one already in flight,
 * or a download/apply in progress, must finish or be cleared first. */
export function canStartCheck(state: UpdateState): boolean {
  return (["idle", "failed", "update-cancelled"] as UpdateState["type"][]).includes(state.type);
}

export interface UpdaterAdapter {
  checkForUpdates(): void;
  downloadUpdate(): void;
  /** Resolves only once `applying` has been reported -- awaited so the
   * real quit call never races the sync meant to precede it. */
  quitAndInstall(): Promise<void>;
  /** No-op if the host never configured a feed URL. */
  setFeedURL(url: string): void;
  getUpdateState(): UpdateState;
  getLastUpdateError(): UpdateFailure | undefined;
  /** The version currently available/downloaded, if any -- `undefined`
   * before `update-available` has ever fired. */
  getTargetVersion(): string | undefined;
  /** Internal state notifications drive reporting and complete public status snapshots. */
  onStateChange(listener: (state: UpdateState) => void | Promise<void>): void;
  /** Fires once per newly recorded failure -- never a replay of one that
   * happened before this listener was registered, same as `onStateChange`. */
  onUpdateError(listener: (failure: UpdateFailure) => void | Promise<void>): void;
}
