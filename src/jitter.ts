const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Deterministic per-installation jitter fraction, fixed for the installation's
 * lifetime: magnitude 10-15%, sign derived from the same hash so it never needs
 * separate storage.
 */
export function computeJitterFraction(installationId: string): number {
  const hash = fnv1a(installationId);
  const sign = (hash & 1) === 0 ? 1 : -1;
  const magnitude = 0.1 + ((hash >>> 1) % 1000) / 1000 / 20; // 0.10..0.15
  return sign * magnitude;
}
