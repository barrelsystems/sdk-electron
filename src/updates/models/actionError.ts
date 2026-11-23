import type { UpdateFailure } from "./failure.js";

export type ActionErrorCode =
  | "notReady"
  | "noUpdateAvailable"
  | "nothingDownloadedYet"
  | "alreadyInProgress"
  | "held"
  | "cancelled"
  | "failed";

/** A manual update action could not complete. Native failures retain their classification. */
export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly failure: UpdateFailure | undefined;

  constructor(code: ActionErrorCode, failure?: UpdateFailure) {
    super(failure?.title ?? `Barrel update action: ${code}`);
    this.name = "ActionError";
    this.code = code;
    this.failure = failure;
  }
}
