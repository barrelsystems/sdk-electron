import { readFile } from "node:fs/promises";
import { createPersistenceWriter } from "./persistenceWriter.js";

let expectedVersion: string | undefined;
let filePath: string | undefined;

const store = createPersistenceWriter(
  () => filePath,
  () => ({ expectedVersion }),
);

/** Read the previous apply expectation before deciding whether that attempt was confirmed by the running version. */
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

/** Persist the expected version before native apply can terminate the process; I/O failure remains fail open. */
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
