import { PROTOCOL_VERSION } from "./wireTypes.js";

import type { CheckInResponse } from "./wireTypes.js";

export interface PostProtocolRequestParams {
  url: string;
  credential: string;
  body: unknown;
  timeoutMs: number;
  /** Prefixes every log message, e.g. "check-in" or "pre-action-check". */
  label: string;
  log?: ((message: string) => void) | undefined;
}

/** POSTs a protocol request and validates the shared envelope: bounded timeout, non-2xx rejection,
 * `protocolVersion` rejection. Fails open (`undefined`) on any failure -- the caller's next scheduled tick
 * is the retry. */
export async function postProtocolRequest(
  params: PostProtocolRequestParams,
): Promise<CheckInResponse | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await fetch(params.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${params.credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(params.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      params.log?.(`${params.label}: received a non-2xx response (${response.status})`);
      return undefined;
    }

    const parsed = (await response.json()) as CheckInResponse;
    if (parsed.protocolVersion !== PROTOCOL_VERSION) {
      params.log?.(
        `${params.label}: rejected unrecognized protocolVersion ${parsed.protocolVersion}`,
      );
      return undefined;
    }

    return parsed;
  } catch (error) {
    params.log?.(
      `${params.label}: failed (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
