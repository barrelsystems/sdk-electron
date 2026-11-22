import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const UUID_PATTERN = /^[0-9a-f-]{36}$/;

describe("getOrCreateInstallationId", () => {
  let dir: string;

  beforeEach(() => {
    vi.resetModules();
    dir = mkdtempSync(join(tmpdir(), "barrel-sdk-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates and persists a fresh id, then reuses it across process restarts", async () => {
    const filePath = join(dir, "installation.json");
    const { getOrCreateInstallationId } = await import("./installationId.js");
    const first = await getOrCreateInstallationId(filePath);
    expect(first).toMatch(UUID_PATTERN);

    vi.resetModules(); // simulate a fresh process: no in-memory cache
    const { getOrCreateInstallationId: rereadFn } = await import("./installationId.js");
    const second = await rereadFn(filePath);
    expect(second).toBe(first);
  });

  it("fails open: keeps the in-memory id when persistence is impossible", async () => {
    // A path whose parent segment is a FILE, not a directory — mkdir(recursive) must fail.
    const blockerFile = join(dir, "blocker");
    writeFileSync(blockerFile, "not a directory");
    const impossiblePath = join(blockerFile, "installation.json");

    const { getOrCreateInstallationId } = await import("./installationId.js");
    const id = await getOrCreateInstallationId(impossiblePath);
    expect(id).toMatch(UUID_PATTERN); // did not throw, did not crash

    // Same call again within this process returns the SAME in-memory id,
    // never silently regenerating a new one.
    const idAgain = await getOrCreateInstallationId(impossiblePath);
    expect(idAgain).toBe(id);
  });

  it("retries the same cached ID after a failed write becomes writable", async () => {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory");
    const path = join(blocker, "installation.json");
    const { getOrCreateInstallationId } = await import("./installationId.js");
    const first = await getOrCreateInstallationId(path);
    rmSync(blocker);

    expect(await getOrCreateInstallationId(path)).toBe(first);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ installationId: first });
  });

  it("serializes concurrent calls onto one resolution, never racing two writes", async () => {
    const filePath = join(dir, "installation.json");
    const { getOrCreateInstallationId } = await import("./installationId.js");

    const [first, second, third] = await Promise.all([
      getOrCreateInstallationId(filePath),
      getOrCreateInstallationId(filePath),
      getOrCreateInstallationId(filePath),
    ]);

    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});
