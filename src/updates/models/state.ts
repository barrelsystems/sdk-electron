import type { FailureCategory, UpdateFailureMode } from "./failure.js";

export type UpdateState =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; releaseNotes?: string }
  | { type: "downloading"; progress?: number; releaseNotes?: string }
  | { type: "downloaded"; releaseNotes?: string }
  | { type: "applying" }
  | { type: "update-cancelled" }
  | {
      type: "failed";
      category: FailureCategory;
      code: UpdateFailureMode;
      platformCode: string;
    };

/** `checking` is SDK-activity, not installation state -- it's a side effect
 * of asking the vendor feed, never a persisted position in the update
 * lifecycle, so it's never the current state reported to the backend. */
export type ReportableUpdateState = Exclude<UpdateState, { type: "checking" }>;

export function isReportableUpdateState(state: UpdateState): state is ReportableUpdateState {
  return state.type !== "checking";
}
