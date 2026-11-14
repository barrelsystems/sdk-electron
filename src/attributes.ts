const MAX_ATTRIBUTE_KEYS = 20;
const MAX_ATTRIBUTE_VALUE_BYTES = 256;

/** Enforces the wire protocol's bounds: at most 20 keys, each value ≤256 UTF-8 bytes. */
export function boundAttributes(attributes: Record<string, string>): Record<string, string> {
  const bounded: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes).slice(0, MAX_ATTRIBUTE_KEYS)) {
    bounded[key] = truncateToByteLimit(value, MAX_ATTRIBUTE_VALUE_BYTES);
  }

  return bounded;
}

function truncateToByteLimit(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maxBytes) return value;

  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = maxBytes; end > 0; end--) {
    try {
      return decoder.decode(encoded.subarray(0, end));
    } catch {
      // Sliced mid-codepoint -- try one byte shorter.
    }
  }

  return "";
}
