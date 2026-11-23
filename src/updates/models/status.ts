import type { UpdateEligibility } from "./eligibility.js";
import type { UpdateFailure } from "./failure.js";
import type { UpdateState } from "./state.js";

/** Complete local update status; idle and absent eligibility/error before asynchronous initialization. */
export interface Status {
  state: UpdateState;
  eligibility: UpdateEligibility | undefined;
  lastError: UpdateFailure | undefined;
}

/** Returned by `subscribe` -- call `remove()` to stop receiving events. */
export interface Subscription {
  remove(): void;
}
