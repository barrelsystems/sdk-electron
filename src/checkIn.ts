import { randomUUID } from "node:crypto";
import { boundAttributes } from "./attributes.js";
import { PROTOCOL_VERSION } from "./types.js";
import type { AdapterState, CheckInRequest, CheckInResponse } from "./types.js";

const CHECK_IN_TIMEOUT_MS = 10_000;

export interface CheckInParams {
  baseUrl: string;
  credential: string;
  installationId: string;
  sdkVersion: string;
  observedVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
  attributes: Record<string, string>;
  adapterState: AdapterState;
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
    installationId: params.installationId,
    eventId: randomUUID(),
    checkedInAt: new Date().toISOString(),
    sdkVersion: params.sdkVersion,
    observedVersion: params.observedVersion,
    platform: params.platform,
    arch: params.arch,
    osVersion: params.osVersion,
    attributes: boundAttributes(params.attributes),
    adapterState: params.adapterState,
    bufferedFacts: [],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_IN_TIMEOUT_MS);

  try {
    const response = await fetch(`${params.baseUrl}/check-in`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${params.credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      params.log?.(`check-in: received a non-2xx response (${response.status})`);
      return undefined;
    }

    const parsed = (await response.json()) as CheckInResponse;
    if (parsed.protocolVersion !== PROTOCOL_VERSION) {
      params.log?.(`check-in: rejected unrecognized protocolVersion ${parsed.protocolVersion}`);
      return undefined;
    }

    params.log?.("check-in: succeeded");
    return parsed;
  } catch (error) {
    params.log?.(`check-in: failed (${error instanceof Error ? error.message : "unknown error"})`);
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
