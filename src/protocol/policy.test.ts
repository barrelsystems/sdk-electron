import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAndParsePolicy } from "./policy.js";
import type { CheckInResponse } from "../types.js";

function signPolicy(policy: string, privateKey: KeyObject): string {
  return sign(null, Buffer.from(policy, "utf8"), privateKey).toString("base64");
}

function toPem(publicKey: KeyObject): string {
  return publicKey.export({ type: "spki", format: "pem" }).toString();
}

describe("verifyAndParsePolicy", () => {
  it.each([
    "not json",
    "null",
    '"current"',
    '{"type":"unknown","issuedAt":"x","environment":"test"}',
    '{"type":"held"}',
    '{"type":"held","issuedAt":"x","environment":"test","reason":42}',
    '{"type":"updateEligible","issuedAt":"x","environment":"test","priority":"urgent"}',
  ])("rejects a signed malformed Policy: %s", (policy) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");

    expect(
      verifyAndParsePolicy(
        {
          protocolVersion: 1,
          policy,
          signature: signPolicy(policy, privateKey),
        },
        toPem(publicKey),
      ),
    ).toBeUndefined();
  });

  it("parses a validly-signed policy", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const policy = JSON.stringify({
      type: "current",
      issuedAt: "2026-01-01T00:00:00Z",
      environment: "production",
    });
    const response: CheckInResponse = {
      protocolVersion: 1,
      policy,
      signature: signPolicy(policy, privateKey),
    };

    expect(verifyAndParsePolicy(response, toPem(publicKey))).toEqual({
      type: "current",
      issuedAt: "2026-01-01T00:00:00Z",
      environment: "production",
    });
  });

  it("fails open (undefined) when the policy is tampered with after signing", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const policy = JSON.stringify({
      type: "current",
      issuedAt: "2026-01-01T00:00:00Z",
      environment: "production",
    });
    const signature = signPolicy(policy, privateKey);
    const response: CheckInResponse = {
      protocolVersion: 1,
      policy: policy.replace("current", "updateEligible"),
      signature,
    };

    expect(verifyAndParsePolicy(response, toPem(publicKey))).toBeUndefined();
  });

  it("fails open (undefined) when the signature doesn't match the key", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const { privateKey: wrongPrivateKey } = generateKeyPairSync("ed25519");
    const policy = JSON.stringify({ type: "current", issuedAt: "x", environment: "production" });
    const response: CheckInResponse = {
      protocolVersion: 1,
      policy,
      signature: signPolicy(policy, wrongPrivateKey),
    };

    expect(verifyAndParsePolicy(response, toPem(publicKey))).toBeUndefined();
  });

  it("fails open (undefined) on an unparseable public key", () => {
    const response: CheckInResponse = { protocolVersion: 1, policy: "{}", signature: "abc" };
    expect(verifyAndParsePolicy(response, "")).toBeUndefined();
  });
});
