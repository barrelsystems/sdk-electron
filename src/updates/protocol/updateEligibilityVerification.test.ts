import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAndParseUpdateEligibility } from "./updateEligibilityVerification.js";

import type { CheckInResponse } from "./wireTypes.js";

function signUpdateEligibility(updateEligibility: string, privateKey: KeyObject): string {
  return sign(null, Buffer.from(updateEligibility, "utf8"), privateKey).toString("base64");
}

function toPem(publicKey: KeyObject): string {
  return publicKey.export({ type: "spki", format: "pem" }).toString();
}

describe("verifyAndParseUpdateEligibility", () => {
  it.each([
    "not json",
    "null",
    '"unrestricted"',
    '{"type":"unknown","issuedAt":"x","environment":"test"}',
    '{"type":"held"}',
    '{"type":"held","issuedAt":"x","environment":"test","reason":42}',
    '{"type":"eligible","issuedAt":"x","environment":"test","priority":"urgent"}',
  ])("rejects a signed malformed UpdateEligibility: %s", (updateEligibility) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");

    expect(
      verifyAndParseUpdateEligibility(
        {
          protocolVersion: 1,
          updateEligibility,
          signature: signUpdateEligibility(updateEligibility, privateKey),
        },
        toPem(publicKey),
      ),
    ).toBeUndefined();
  });

  it("parses a validly-signed updateEligibility", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const updateEligibility = JSON.stringify({
      type: "unrestricted",
      issuedAt: "2026-01-01T00:00:00Z",
      environment: "production",
    });
    const response: CheckInResponse = {
      protocolVersion: 1,
      updateEligibility,
      signature: signUpdateEligibility(updateEligibility, privateKey),
    };

    expect(verifyAndParseUpdateEligibility(response, toPem(publicKey))).toEqual({
      type: "unrestricted",
      issuedAt: "2026-01-01T00:00:00Z",
      environment: "production",
    });
  });

  it("fails open (undefined) when the updateEligibility is tampered with after signing", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const updateEligibility = JSON.stringify({
      type: "unrestricted",
      issuedAt: "2026-01-01T00:00:00Z",
      environment: "production",
    });
    const signature = signUpdateEligibility(updateEligibility, privateKey);
    const response: CheckInResponse = {
      protocolVersion: 1,
      updateEligibility: updateEligibility.replace("unrestricted", "eligible"),
      signature,
    };

    expect(verifyAndParseUpdateEligibility(response, toPem(publicKey))).toBeUndefined();
  });

  it("fails open (undefined) when the signature doesn't match the key", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const { privateKey: wrongPrivateKey } = generateKeyPairSync("ed25519");
    const updateEligibility = JSON.stringify({
      type: "unrestricted",
      issuedAt: "x",
      environment: "production",
    });
    const response: CheckInResponse = {
      protocolVersion: 1,
      updateEligibility,
      signature: signUpdateEligibility(updateEligibility, wrongPrivateKey),
    };

    expect(verifyAndParseUpdateEligibility(response, toPem(publicKey))).toBeUndefined();
  });

  it("fails open (undefined) on an unparseable public key", () => {
    const response: CheckInResponse = {
      protocolVersion: 1,
      updateEligibility: "{}",
      signature: "abc",
    };
    expect(verifyAndParseUpdateEligibility(response, "")).toBeUndefined();
  });
});
