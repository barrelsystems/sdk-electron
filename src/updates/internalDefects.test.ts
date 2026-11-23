import { beforeEach, describe, expect, it, vi } from "vitest";

describe("internalDefects", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("guardAdapterCallback runs fn and changes nothing on success", async () => {
    const { getInternalDefectCounts, guardAdapterCallback } = await import("./internalDefects.js");
    let ran = false;

    guardAdapterCallback("test:cause", () => {
      ran = true;
    });

    expect(ran).toBe(true);
    expect(getInternalDefectCounts().get("test:cause")).toBeUndefined();
  });

  it("guardAdapterCallback swallows a throw and tallies it by cause, never re-throwing", async () => {
    const { getInternalDefectCounts, guardAdapterCallback } = await import("./internalDefects.js");

    expect(() =>
      guardAdapterCallback("test:cause", () => {
        throw new Error("boom");
      }),
    ).not.toThrow();

    expect(getInternalDefectCounts().get("test:cause")).toBe(1);
  });

  it("increments the same cause's count across repeated defects", async () => {
    const { getInternalDefectCounts, guardAdapterCallback } = await import("./internalDefects.js");

    guardAdapterCallback("test:cause", () => {
      throw new Error("boom");
    });
    guardAdapterCallback("test:cause", () => {
      throw new Error("boom again");
    });

    expect(getInternalDefectCounts().get("test:cause")).toBe(2);
  });
});
