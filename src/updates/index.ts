import { runtime } from "./runtime.js";
import type { Status, Subscription } from "./models/status.js";

export type { Config } from "./models/configuration.js";
export type { Status, Subscription } from "./models/status.js";
export type { UpdateState as State } from "./models/state.js";
export type { UpdateEligibility as Eligibility } from "./models/eligibility.js";
export type {
  Phase,
  FailureCategory,
  UpdateFailure as Failure,
  UpdateFailureMode as FailureMode,
} from "./models/failure.js";
export { ActionError, type ActionErrorCode } from "./models/actionError.js";

/** Delivers a complete snapshot immediately and after changes; remove to unsubscribe. */
export function subscribe(listener: (status: Status) => void): Subscription {
  return runtime.subscribe(listener);
}

/** Resolves after verified download completion; rejects with ActionError otherwise. */
export function download(): Promise<void> {
  return runtime.download();
}

/** Resolves at installer handoff; successful relaunch cannot be observed in this process. */
export function apply(): Promise<void> {
  return runtime.apply();
}
