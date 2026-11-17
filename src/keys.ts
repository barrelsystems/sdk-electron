/** Ed25519 public verification key, embedded at build time. Public by
 * design -- only its matching private half, held server-side, is secret.
 * This is production's own key specifically: DEFAULT_BASE_URL below is
 * production's ingest endpoint, and a dev/test stage signs with a
 * deliberately different keypair this constant can't verify. */
export const PUBLIC_ED25519_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAoQf7qhQlr7W9x6EvTwriO/EluLP1IWbn77nFRkxXKZ4=
-----END PUBLIC KEY-----
`;

export const DEFAULT_BASE_URL = "https://ingest.barrel.codes";
