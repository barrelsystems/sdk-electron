import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateFailure } from "../types.js";

const FAILURE: UpdateFailure = {
  phase: "download",
  failureMode: "download-transport-failed",
  title: "The update download failed at the network layer.",
  platform: "electron-updater",
  platformCode: "ENOTFOUND",
};

describe("bufferedFacts", () => {
  let dir: string;

  beforeEach(() => {
    vi.resetModules();
    dir = mkdtempSync(join(tmpdir(), "barrel-sdk-facts-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves an unsent equal-valued observation across repeated acknowledgments", async () => {
    const {
      configureBufferedFacts,
      getBufferedFacts,
      recordAdapterStateFact,
      clearBufferedFacts,
      waitForBufferedFactsPersistence,
    } = await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    try {
      recordAdapterStateFact({ type: "checking" });
      const sent = getBufferedFacts();
      recordAdapterStateFact({ type: "downloaded" });
      recordAdapterStateFact({ type: "checking" });
      const before = getBufferedFacts();
      expect(before[0]).toEqual(before[2]);

      clearBufferedFacts(sent);
      expect(getBufferedFacts()).toEqual(before.slice(1));
      clearBufferedFacts(sent);
      expect(getBufferedFacts()).toEqual(before.slice(1));
      await waitForBufferedFactsPersistence();
    } finally {
      vi.useRealTimers();
    }
  });

  it("appends a new fact for a state never seen before", async () => {
    const { configureBufferedFacts, getBufferedFacts, recordAdapterStateFact } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    recordAdapterStateFact({ type: "checking" });
    recordAdapterStateFact({ type: "available" });

    expect(getBufferedFacts()).toHaveLength(2);
  });

  it("merges a repeated fact into its existing entry instead of appending a new one", async () => {
    const { configureBufferedFacts, getBufferedFacts, recordAdapterStateFact } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    recordAdapterStateFact({ type: "checking" });
    recordAdapterStateFact({ type: "checking" });
    recordAdapterStateFact({ type: "checking" });

    const facts = getBufferedFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ occurrenceCount: 3 });
  });

  it("merges equivalent state fields regardless of object property order", async () => {
    const { configureBufferedFacts, getBufferedFacts, recordAdapterStateFact } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));
    recordAdapterStateFact({ type: "downloading", progress: 10 });
    recordAdapterStateFact({ progress: 10, type: "downloading" });
    expect(getBufferedFacts()).toHaveLength(1);
    expect(getBufferedFacts()[0]).toMatchObject({ occurrenceCount: 2 });
  });

  it("keeps two available facts distinct when their release notes differ, instead of collapsing them", async () => {
    const { configureBufferedFacts, getBufferedFacts, recordAdapterStateFact } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    recordAdapterStateFact({ type: "available", releaseNotes: "Fixed a crash on launch." });
    recordAdapterStateFact({ type: "available", releaseNotes: "Added dark mode." });

    const facts = getBufferedFacts();
    expect(facts).toHaveLength(2);
  });

  it("merges a repeated updateError by failureMode + platformCode, bumping occurrenceCount", async () => {
    const { configureBufferedFacts, getBufferedFacts, recordUpdateErrorFact } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    recordUpdateErrorFact(FAILURE);
    recordUpdateErrorFact(FAILURE);

    const facts = getBufferedFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ kind: "updateError", occurrenceCount: 2 });
  });

  it("never persists title -- it's a derived function of failureMode, resolved only at read time", async () => {
    const { configureBufferedFacts, getBufferedFacts, recordUpdateErrorFact } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    recordUpdateErrorFact(FAILURE);

    const [fact] = getBufferedFacts();
    if (fact?.kind !== "updateError") throw new Error("expected an updateError fact");
    expect("title" in fact.failure).toBe(false);
  });

  it("getLastBufferedUpdateError returns the most recently observed updateError fact, title re-derived", async () => {
    const { configureBufferedFacts, getLastBufferedUpdateError, recordUpdateErrorFact } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    recordUpdateErrorFact(FAILURE);
    recordUpdateErrorFact({ ...FAILURE, platformCode: "ECONNRESET" });

    const buffered = getLastBufferedUpdateError();
    expect(buffered).toMatchObject({
      failureMode: "download-transport-failed",
      platformCode: "ECONNRESET",
    });
    expect(buffered && "title" in buffered).toBe(false);
  });

  it("getLastBufferedUpdateError returns undefined when nothing has been buffered", async () => {
    const { configureBufferedFacts, getLastBufferedUpdateError } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    expect(getLastBufferedUpdateError()).toBeUndefined();
  });

  it("keeps distinct checking/failure windows bounded without merging across intervening facts", async () => {
    const {
      configureBufferedFacts,
      getBufferedFacts,
      recordAdapterStateFact,
      recordUpdateErrorFact,
    } = await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    for (let i = 0; i < 20; i++) {
      recordAdapterStateFact({ type: "checking" });
      recordUpdateErrorFact(FAILURE);
    }

    // Each checking/failure pair is a separate observation window.
    expect(getBufferedFacts()).toHaveLength(32);
    expect(getBufferedFacts().filter((fact) => fact.kind === "updateError")).toHaveLength(20);
  });

  it("caps at 32 entries, evicting the lowest-priority, oldest entry to make room", async () => {
    const { configureBufferedFacts, getBufferedFacts, recordUpdateErrorFact } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    for (let i = 0; i < 32; i++) {
      recordUpdateErrorFact({ ...FAILURE, platformCode: `code-${i}` });
    }
    expect(getBufferedFacts()).toHaveLength(32);

    recordUpdateErrorFact({ ...FAILURE, platformCode: "code-32" });

    const facts = getBufferedFacts();
    expect(facts).toHaveLength(32);
    // The oldest entry (code-0) was evicted; the newest (code-32) is present.
    expect(
      facts.some((fact) => fact.kind === "updateError" && fact.failure.platformCode === "code-0"),
    ).toBe(false);
    expect(
      facts.some((fact) => fact.kind === "updateError" && fact.failure.platformCode === "code-32"),
    ).toBe(true);
  });

  it("drops an incoming intermediate fact rather than evicting a higher-priority terminal one", async () => {
    const {
      configureBufferedFacts,
      getBufferedFacts,
      recordAdapterStateFact,
      recordUpdateErrorFact,
    } = await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    // Fill the buffer entirely with terminal (highest-priority) facts.
    for (let i = 0; i < 32; i++) {
      recordUpdateErrorFact({ ...FAILURE, platformCode: `code-${i}` });
    }

    // An intermediate fact, lower priority than everything present, must be dropped.
    recordAdapterStateFact({ type: "checking" });

    const facts = getBufferedFacts();
    expect(facts).toHaveLength(32);
    expect(facts.some((fact) => fact.kind === "adapterState")).toBe(false);
  });

  it("persists to disk non-blocking and reloads across a simulated restart", async () => {
    const filePath = join(dir, "facts.json");
    const first = await import("./bufferedFacts.js");
    await first.configureBufferedFacts(filePath);
    first.recordAdapterStateFact({ type: "downloaded" });

    await new Promise((resolve) => setTimeout(resolve, 10)); // let the fire-and-forget write land

    vi.resetModules(); // simulate a fresh process: no in-memory cache
    const second = await import("./bufferedFacts.js");
    await second.configureBufferedFacts(filePath);
    expect(second.getBufferedFacts()).toHaveLength(1);
  });

  it("fails open: keeps the fact in-memory when persistence is impossible", async () => {
    const blockerFile = join(dir, "blocker");
    writeFileSync(blockerFile, "not a directory");
    const impossiblePath = join(blockerFile, "facts.json");

    const { configureBufferedFacts, getBufferedFacts, recordAdapterStateFact } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(impossiblePath);
    recordAdapterStateFact({ type: "checking" });

    expect(getBufferedFacts()).toHaveLength(1);
  });

  it("clearBufferedFacts empties the buffer", async () => {
    const { configureBufferedFacts, getBufferedFacts, recordAdapterStateFact, clearBufferedFacts } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    recordAdapterStateFact({ type: "checking" });
    const sent = getBufferedFacts();
    clearBufferedFacts(sent);

    expect(getBufferedFacts()).toHaveLength(0);
  });

  it("does not drop a fact recorded after the snapshot was taken but before the ACK clears it", async () => {
    const { configureBufferedFacts, getBufferedFacts, recordAdapterStateFact, clearBufferedFacts } =
      await import("./bufferedFacts.js");
    await configureBufferedFacts(join(dir, "facts.json"));

    recordAdapterStateFact({ type: "checking" });
    const sent = getBufferedFacts(); // the snapshot a check-in would have sent

    recordAdapterStateFact({ type: "available" }); // arrives while that check-in is still in flight

    clearBufferedFacts(sent); // the ACK for the in-flight check-in arrives

    const remaining = getBufferedFacts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ kind: "adapterState", state: { type: "available" } });
  });
});
