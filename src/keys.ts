/**
 * Per-environment Ed25519 public verification key, embedded at build time.
 * Empty until real key provisioning lands server-side — safe to ship since
 * an empty key makes verification fail open, not throw unexpectedly.
 */
export const PUBLIC_ED25519_KEY_PEM = "";

export const DEFAULT_BASE_URL = "https://ingest.barrel.codes";
