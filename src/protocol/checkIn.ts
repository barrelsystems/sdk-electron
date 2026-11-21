import { randomUUID } from "node:crypto";
import { boundAttributes } from "../attributes.js";
import type { BufferedFact } from "../persistence/bufferedFacts.js";
import { postProtocolRequest } from "./postProtocolRequest.js";
import { PROTOCOL_VERSION } from "../types.js";
import type {
  AdapterState,
  BackendConnection,
  CheckInRequest,
  CheckInResponse,
  WireBufferedFact,
} from "../types.js";

const CHECK_IN_TIMEOUT_MS = 10_000;

/** The backend expects `updateError` facts flattened (`phase`/`failureMode`/
 * `platformCode` directly), not nested under `failure` the way the internal,
 * on-disk shape carries them. */
function toWireBufferedFact(fact: BufferedFact): WireBufferedFact {
  if (fact.kind === "adapterState") return fact;
  const { failure, kind, ...timestamps } = fact;
  return {
    kind,
    phase: failure.phase,
    failureMode: failure.failureMode,
    platformCode: failure.platformCode,
    ...timestamps,
  };
}

export interface CheckInParams {
  connection: BackendConnection;
  sdkVersion: string;
  observedVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
  attributes: Record<string, string>;
  adapterState: AdapterState;
  bufferedFacts: readonly BufferedFact[];
  log?: ((message: string) => void) | undefined;
}

/**
 * Sends one check-in attempt with a bounded timeout. There is no retry loop
 * here by design — any failure (network error, non-2xx, timeout) resolves to
 * `undefined`, and the caller's next scheduled tick is the retry.
 */
export async function sendCheckIn(params: CheckInParams): Promise<CheckInResponse | undefined> {
  const body: CheckInRequest = {
    protocolVersion: PROTOCOL_VERSION,
    installationId: params.connection.installationId,
    eventId: randomUUID(),
    checkedInAt: new Date().toISOString(),
    sdkVersion: params.sdkVersion,
    observedVersion: params.observedVersion,
    platform: params.platform,
    arch: params.arch,
    osVersion: params.osVersion,
    attributes: boundAttributes(params.attributes),
    adapterState: params.adapterState,
    bufferedFacts: params.bufferedFacts.map(toWireBufferedFact),
  };

  const parsed = await postProtocolRequest({
    url: `${params.connection.baseUrl}/check-in`,
    credential: params.connection.credential,
    body,
    timeoutMs: CHECK_IN_TIMEOUT_MS,
    label: "check-in",
    log: params.log,
  });

  if (parsed) params.log?.("check-in: succeeded");
  return parsed;
}
