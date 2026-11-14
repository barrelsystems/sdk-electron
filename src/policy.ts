import { createPublicKey, verify } from "node:crypto";
import type { CheckInResponse, Policy } from "./types.js";

/**
 * Verifies the raw `policy` byte string's Ed25519 signature via native
 * crypto, then parses it. Any failure fails open, returning `undefined`.
 */
export function verifyAndParsePolicy(
  response: CheckInResponse,
  publicKeyPem: string,
): Policy | undefined {
  try {
    const publicKey = createPublicKey(publicKeyPem);
    const signatureIsValid = verify(
      null,
      Buffer.from(response.policy, "utf8"),
      publicKey,
      Buffer.from(response.signature, "base64"),
    );
    if (!signatureIsValid) return undefined;

    return JSON.parse(response.policy) as Policy;
  } catch {
    return undefined;
  }
}
