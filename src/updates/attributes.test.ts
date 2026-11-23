import { describe, expect, it } from "vitest";
import { boundAttributes } from "./attributes.js";

describe("boundAttributes", () => {
  it("passes through attributes within bounds unchanged", () => {
    expect(boundAttributes({ tier: "pro", seat: "42" })).toEqual({ tier: "pro", seat: "42" });
  });

  it("keeps only the first 20 keys", () => {
    const attributes = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`key${i}`, "v"]));
    expect(Object.keys(boundAttributes(attributes))).toHaveLength(20);
  });

  it("truncates a value over 256 bytes without splitting a multi-byte character", () => {
    const value = "é".repeat(200); // 2 bytes each in UTF-8, 400 bytes total
    const result = boundAttributes({ key: value })["key"] ?? "";
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(256);
    expect(result).not.toContain("�");
  });
});
