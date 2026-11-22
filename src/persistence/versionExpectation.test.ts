import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function readPersistedExpectation(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

describe("versionExpectation", () => {
  let dir: string;

  beforeEach(() => {
    vi.resetModules();
    dir = mkdtempSync(join(tmpdir(), "barrel-sdk-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined when nothing was ever expected", async () => {
    const filePath = join(dir, "version-expectation.json");
    const { configureVersionExpectation } = await import("./versionExpectation.js");

    expect(await configureVersionExpectation(filePath)).toBeUndefined();
  });

  it("persists an expected version and reads it back after a simulated restart", async () => {
    const filePath = join(dir, "version-expectation.json");
    const { configureVersionExpectation, setExpectedVersion } =
      await import("./versionExpectation.js");
    await configureVersionExpectation(filePath);
    setExpectedVersion("2.0.0");

    await vi.waitFor(async () => {
      expect(await readPersistedExpectation(filePath)).toEqual({ expectedVersion: "2.0.0" });
    });

    vi.resetModules(); // simulate a fresh process: no in-memory cache
    const reread = await import("./versionExpectation.js");
    expect(await reread.configureVersionExpectation(filePath)).toBe("2.0.0");
  });

  it("clearing the expectation persists across a restart", async () => {
    const filePath = join(dir, "version-expectation.json");
    const { configureVersionExpectation, setExpectedVersion, clearExpectedVersion } =
      await import("./versionExpectation.js");
    await configureVersionExpectation(filePath);
    setExpectedVersion("2.0.0");
    await vi.waitFor(async () => {
      expect(await readPersistedExpectation(filePath)).toEqual({ expectedVersion: "2.0.0" });
    });

    clearExpectedVersion();
    await vi.waitFor(async () => {
      expect(await readPersistedExpectation(filePath)).toEqual({ expectedVersion: undefined });
    });

    vi.resetModules();
    const reread = await import("./versionExpectation.js");
    expect(await reread.configureVersionExpectation(filePath)).toBeUndefined();
  });
});
