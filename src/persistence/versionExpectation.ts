import { readFile } from "node:fs/promises";
import { createDiskStore } from "./diskStore.js";

let expectedVersion: string | undefined;
let filePath: string | undefined;

const store = createDiskStore(
  () => filePath,
  () => ({ expectedVersion }),
);

/**
 * Hydrates the persisted expectation from disk and returns it. Call once at
 * startup, before deciding whether the last apply attempt actually landed.
 */
export async function configureVersionExpectation(path: string): Promise<string | undefined> {
  filePath = path;

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { expectedVersion?: string };
    expectedVersion = parsed.expectedVersion;
  } catch {
    // No prior marker on disk, or it's unreadable -- nothing was expected.
  }

  return expectedVersion;
}

/**
 * Call immediately before triggering apply, with the version being
 * applied -- awaited, not fire-and-forget: `quitAndInstall()` can exit the
 * process as soon as it's called, so this must land on disk first.
 */
export async function setExpectedVersion(version: string): Promise<void> {
  expectedVersion = version;
  await store.persist();
}

/** Call once an expectation has been resolved -- either startup confirmed
 * it, or this session's own code already classified why it didn't. */
export async function clearExpectedVersion(): Promise<void> {
  expectedVersion = undefined;
  await store.persist();
}
