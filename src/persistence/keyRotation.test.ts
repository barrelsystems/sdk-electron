import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckInResponse } from "../types.js";

function toPem(key: KeyObject): string {
  return key.export({ type: "spki", format: "pem" }).toString();
}

function signWith(payload: string, privateKey: KeyObject): string {
  return sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");
}

function baseResponse(overrides: Partial<CheckInResponse> = {}): CheckInResponse {
  return { protocolVersion: 1, policy: "{}", signature: "sig", ...overrides };
}

describe("keyRotation", () => {
  let dir: string;

  beforeEach(() => {
    vi.resetModules();
    dir = mkdtempSync(join(tmpdir(), "barrel-sdk-key-rotation-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("getOrCreateTrustedKey falls back to the build-time default when nothing is cached", async () => {
    const { getOrCreateTrustedKey } = await import("./keyRotation.js");
    const trusted = await getOrCreateTrustedKey(join(dir, "key.json"), "built-in-key-pem");
    expect(trusted).toBe("built-in-key-pem");
  });

  it("adopts a rotation announcement validly signed by the currently trusted key", async () => {
    const { publicKey: currentPublic, privateKey: currentPrivate } = generateKeyPairSync("ed25519");
    const { publicKey: nextPublic } = generateKeyPairSync("ed25519");
    const nextPublicKeyPem = toPem(nextPublic);

    const { getOrCreateTrustedKey, applyKeyRotationIfPresent, getTrustedKey } =
      await import("./keyRotation.js");
    await getOrCreateTrustedKey(join(dir, "key.json"), toPem(currentPublic));

    applyKeyRotationIfPresent(
      baseResponse({
        nextPublicKeyPem,
        nextPublicKeySignature: signWith(nextPublicKeyPem, currentPrivate),
      }),
    );

    expect(getTrustedKey()).toBe(nextPublicKeyPem);
  });

  it("fails open: rejects a rotation signed by a key other than the one currently trusted", async () => {
    const { publicKey: currentPublic } = generateKeyPairSync("ed25519");
    const { privateKey: imposterPrivate } = generateKeyPairSync("ed25519");
    const { publicKey: nextPublic } = generateKeyPairSync("ed25519");
    const nextPublicKeyPem = toPem(nextPublic);
    const currentPublicKeyPem = toPem(currentPublic);

    const { getOrCreateTrustedKey, applyKeyRotationIfPresent, getTrustedKey } =
      await import("./keyRotation.js");
    await getOrCreateTrustedKey(join(dir, "key.json"), currentPublicKeyPem);

    applyKeyRotationIfPresent(
      baseResponse({
        nextPublicKeyPem,
        nextPublicKeySignature: signWith(nextPublicKeyPem, imposterPrivate),
      }),
    );

    expect(getTrustedKey()).toBe(currentPublicKeyPem);
  });

  it("fails open: a response with no rotation fields leaves the current key untouched", async () => {
    const { publicKey: currentPublic } = generateKeyPairSync("ed25519");
    const currentPublicKeyPem = toPem(currentPublic);

    const { getOrCreateTrustedKey, applyKeyRotationIfPresent, getTrustedKey } =
      await import("./keyRotation.js");
    await getOrCreateTrustedKey(join(dir, "key.json"), currentPublicKeyPem);

    applyKeyRotationIfPresent(baseResponse());

    expect(getTrustedKey()).toBe(currentPublicKeyPem);
  });

  it("fails open: malformed next-key material is rejected even with a validly-signed envelope", async () => {
    const { publicKey: currentPublic, privateKey: currentPrivate } = generateKeyPairSync("ed25519");
    const currentPublicKeyPem = toPem(currentPublic);
    const malformedKey = "not a real PEM";

    const { getOrCreateTrustedKey, applyKeyRotationIfPresent, getTrustedKey } =
      await import("./keyRotation.js");
    await getOrCreateTrustedKey(join(dir, "key.json"), currentPublicKeyPem);

    applyKeyRotationIfPresent(
      baseResponse({
        nextPublicKeyPem: malformedKey,
        nextPublicKeySignature: signWith(malformedKey, currentPrivate),
      }),
    );

    expect(getTrustedKey()).toBe(currentPublicKeyPem);
  });

  it("persists an adopted rotation and reloads it as trusted across a simulated restart", async () => {
    const filePath = join(dir, "key.json");
    const { publicKey: currentPublic, privateKey: currentPrivate } = generateKeyPairSync("ed25519");
    const { publicKey: nextPublic } = generateKeyPairSync("ed25519");
    const nextPublicKeyPem = toPem(nextPublic);

    const first = await import("./keyRotation.js");
    await first.getOrCreateTrustedKey(filePath, toPem(currentPublic));
    first.applyKeyRotationIfPresent(
      baseResponse({
        nextPublicKeyPem,
        nextPublicKeySignature: signWith(nextPublicKeyPem, currentPrivate),
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10)); // let the fire-and-forget write land

    vi.resetModules(); // simulate a fresh process: no in-memory cache
    const second = await import("./keyRotation.js");
    const resolved = await second.getOrCreateTrustedKey(filePath, "a-different-build-time-default");
    expect(resolved).toBe(nextPublicKeyPem);
  });

  it("fails open: keeps the adopted key in-memory when persistence is impossible", async () => {
    const blockerFile = join(dir, "blocker");
    writeFileSync(blockerFile, "not a directory");
    const impossiblePath = join(blockerFile, "key.json");

    const { publicKey: currentPublic, privateKey: currentPrivate } = generateKeyPairSync("ed25519");
    const { publicKey: nextPublic } = generateKeyPairSync("ed25519");
    const nextPublicKeyPem = toPem(nextPublic);

    const { getOrCreateTrustedKey, applyKeyRotationIfPresent, getTrustedKey } =
      await import("./keyRotation.js");
    await getOrCreateTrustedKey(impossiblePath, toPem(currentPublic));
    applyKeyRotationIfPresent(
      baseResponse({
        nextPublicKeyPem,
        nextPublicKeySignature: signWith(nextPublicKeyPem, currentPrivate),
      }),
    );

    expect(getTrustedKey()).toBe(nextPublicKeyPem);
  });
});
