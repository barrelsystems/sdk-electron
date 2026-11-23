import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { CheckInResponse } from "../protocol/wireTypes.js";
import { createPersistenceWriter } from "./persistenceWriter.js";

let cachedTrustedKeyPem: string | undefined;
let filePath: string | undefined;

const store = createPersistenceWriter(
  () => filePath,
  () => ({ publicKeyPem: cachedTrustedKeyPem }),
);

/** Resolves the key this SDK currently trusts: a previously-adopted rotation cached on disk, or the
 * build-time default otherwise. Call once at startup, before the first check-in's UpdateEligibility
 * is verified. */
export async function getOrCreateTrustedKey(path: string, builtInKeyPem: string): Promise<string> {
  filePath = path;

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { publicKeyPem?: string };
    if (parsed.publicKeyPem !== undefined) {
      cachedTrustedKeyPem = parsed.publicKeyPem;
      return cachedTrustedKeyPem;
    }
  } catch {
    // No prior rotation on disk, or it's unreadable -- fall through to the build-time default.
  }

  cachedTrustedKeyPem = builtInKeyPem;
  return cachedTrustedKeyPem;
}

/** The key currently in effect. `undefined` only if called before `getOrCreateTrustedKey`. */
export function getTrustedKey(): string | undefined {
  return cachedTrustedKeyPem;
}

/** Verifies a rotation announcement against the key this SDK ALREADY trusts, never the new key -- a key can
 * only vouch for its own successor. */
export function applyKeyRotationIfPresent(response: CheckInResponse): void {
  const { nextPublicKeyPem, nextPublicKeySignature } = response;
  if (nextPublicKeyPem === undefined || nextPublicKeySignature === undefined) return;

  const currentKeyPem = cachedTrustedKeyPem;
  if (currentKeyPem === undefined) return;

  try {
    const currentPublicKey = createPublicKey(currentKeyPem);
    const signatureIsValid = verify(
      null,
      Buffer.from(nextPublicKeyPem, "utf8"),
      currentPublicKey,
      Buffer.from(nextPublicKeySignature, "base64"),
    );
    if (!signatureIsValid) return;

    createPublicKey(nextPublicKeyPem); // throws on malformed key material -- validate before adopting
    cachedTrustedKeyPem = nextPublicKeyPem;
    void store.persist();
  } catch {
    // Fails open: malformed key material or a bad signature leaves the current key in effect.
  }
}
