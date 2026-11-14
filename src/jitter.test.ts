import { describe, expect, it } from "vitest";
import { computeJitterFraction } from "./jitter.js";

describe("computeJitterFraction", () => {
  it("stays within ±10-15%", () => {
    for (const id of ["a", "installation-123", "zzzzzzzz", "", "non-ascii-🎯"]) {
      const fraction = computeJitterFraction(id);
      expect(Math.abs(fraction)).toBeGreaterThanOrEqual(0.1);
      expect(Math.abs(fraction)).toBeLessThanOrEqual(0.15);
    }
  });

  it("is deterministic for the same installation id", () => {
    const id = "same-installation";
    expect(computeJitterFraction(id)).toBe(computeJitterFraction(id));
  });

  it("varies across different installation ids", () => {
    const fractions = new Set(["a", "b", "c", "d"].map((id) => computeJitterFraction(id)));
    expect(fractions.size).toBeGreaterThan(1);
  });
});
