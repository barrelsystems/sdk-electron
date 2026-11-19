import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiskStore } from "./diskStore.js";

describe("createDiskStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "barrel-sdk-diskstore-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists the current snapshot to disk, creating the directory if needed", async () => {
    const filePath = join(dir, "nested", "value.json");
    const store = createDiskStore(
      () => filePath,
      () => ({ hello: "world" }),
    );

    await store.persist();

    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ hello: "world" });
  });

  it("is a no-op when getPath() returns undefined", async () => {
    const filePath = join(dir, "value.json");
    const store = createDiskStore(
      () => undefined,
      () => ({ hello: "world" }),
    );

    await store.persist();

    expect(() => readFileSync(filePath, "utf8")).toThrow();
  });

  it("fails open: resolves without throwing when the path is impossible to write to", async () => {
    const blockerFile = join(dir, "blocker");
    writeFileSync(blockerFile, "not a directory");
    const impossiblePath = join(blockerFile, "value.json");
    const store = createDiskStore(
      () => impossiblePath,
      () => ({ hello: "world" }),
    );

    await expect(store.persist()).resolves.toBeUndefined();
  });

  it("serializes overlapping persist() calls so the file always lands on the latest snapshot", async () => {
    const filePath = join(dir, "value.json");
    let snapshot = { count: 1 };
    const store = createDiskStore(
      () => filePath,
      () => snapshot,
    );

    const first = store.persist();
    snapshot = { count: 2 };
    const second = store.persist();
    await Promise.all([first, second]);

    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ count: 2 });
  });
});
