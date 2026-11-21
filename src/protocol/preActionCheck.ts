import { verifyAndParsePolicy } from "./policy.js";
import { postProtocolRequest } from "./postProtocolRequest.js";
import { PROTOCOL_VERSION } from "../types.js";
import type { BackendConnection, Policy } from "../types.js";

const PRE_ACTION_CHECK_TIMEOUT_MS = 10_000;

export interface PreActionCheckParams {
  connection: BackendConnection;
  stage: "pre-download" | "pre-apply";
  trustedKeyPem: string;
  log?: ((message: string) => void) | undefined;
}

/**
 * Asks whether it's still safe to act right now -- narrower than a full
 * check-in, no state sync. Any failure (network, non-2xx, bad signature)
 * fails open: the caller proceeds exactly as it would under a `current` Policy.
 */
export async function checkPreAction(params: PreActionCheckParams): Promise<Policy | undefined> {
  const parsed = await postProtocolRequest({
    url: `${params.connection.baseUrl}/pre-action-check`,
    credential: params.connection.credential,
    body: {
      protocolVersion: PROTOCOL_VERSION,
      installationId: params.connection.installationId,
      stage: params.stage,
    },
    timeoutMs: PRE_ACTION_CHECK_TIMEOUT_MS,
    label: "pre-action-check",
    log: params.log,
  });

  if (!parsed) return undefined;
  return verifyAndParsePolicy(parsed, params.trustedKeyPem);
}
