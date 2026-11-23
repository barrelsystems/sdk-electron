import { createPublicKey, verify } from "node:crypto";
import type { UpdateEligibility } from "../models/eligibility.js";
import type { CheckInResponse } from "./wireTypes.js";

/** Verifies the raw `updateEligibility` byte string's Ed25519 signature via native crypto, then parses it.
 * Any failure fails open, returning `undefined`. */
export function verifyAndParseUpdateEligibility(
  response: CheckInResponse,
  publicKeyPem: string,
): UpdateEligibility | undefined {
  try {
    const publicKey = createPublicKey(publicKeyPem);
    const signatureIsValid = verify(
      null,
      Buffer.from(response.updateEligibility, "utf8"),
      publicKey,
      Buffer.from(response.signature, "base64"),
    );
    if (!signatureIsValid) return undefined;

    const value: unknown = JSON.parse(response.updateEligibility);

    if (!isUpdateEligibility(value)) return undefined;

    return value;
  } catch {
    return undefined;
  }
}

function isUpdateEligibility(value: unknown): value is UpdateEligibility {
  if (typeof value !== "object" || value === null) return false;
  if (!("issuedAt" in value) || typeof value.issuedAt !== "string") return false;
  if (!("environment" in value) || typeof value.environment !== "string") return false;
  if (!("type" in value)) return false;

  switch (value.type) {
    case "unrestricted":
      return true;
    case "held":
      return (
        (!("reason" in value) || typeof value.reason === "string") &&
        (!("until" in value) || typeof value.until === "string")
      );
    case "eligible":
      return !("priority" in value) || value.priority === "normal" || value.priority === "high";
    default:
      return false;
  }
}
