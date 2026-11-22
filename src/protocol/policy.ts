import { createPublicKey, verify } from "node:crypto";
import type { CheckInResponse, Policy } from "../types.js";

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

    const value: unknown = JSON.parse(response.policy);

    if (!isPolicy(value)) return undefined;

    return value;
  } catch {
    return undefined;
  }
}

function isPolicy(value: unknown): value is Policy {
  if (typeof value !== "object" || value === null) return false;
  if (!("issuedAt" in value) || typeof value.issuedAt !== "string") return false;
  if (!("environment" in value) || typeof value.environment !== "string") return false;
  if (!("type" in value)) return false;

  switch (value.type) {
    case "current":
      return true;
    case "held":
      return (
        (!("reason" in value) || typeof value.reason === "string") &&
        (!("until" in value) || typeof value.until === "string")
      );
    case "updateEligible":
      return !("priority" in value) || value.priority === "normal" || value.priority === "high";
    default:
      return false;
  }
}
