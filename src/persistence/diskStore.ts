import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Mirrors an in-memory value to disk: a non-blocking write on `persist()`,
 * fail-open on any disk error, and a synchronous exit-time fallback -- the
 * shape every local-state module in this SDK needs (installation ID,
 * bufferedFacts, the trusted key).
 */
export interface DiskStore {
  persist(): Promise<void>;
}

export function createDiskStore(
  getPath: () => string | undefined,
  getSnapshot: () => unknown,
): DiskStore {
  let mutex: Promise<void> = Promise.resolve();
  let exitFallbackRegistered = false;

  // A value changed right before exit must still land on disk -- 'exit' only
  // allows synchronous work, so this is the one place a sync fs call belongs.
  function registerExitFallback(): void {
    if (exitFallbackRegistered) return;
    exitFallbackRegistered = true;

    process.once("exit", () => {
      const path = getPath();
      if (path === undefined) return;
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(getSnapshot()), "utf8");
      } catch {
        // Nothing more can be done once the process is already exiting.
      }
    });
  }

  registerExitFallback();

  return {
    persist(): Promise<void> {
      const path = getPath();
      if (path === undefined) return Promise.resolve();

      const snapshot = getSnapshot();
      mutex = mutex.then(async () => {
        try {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify(snapshot), "utf8");
        } catch {
          // Fail open: disk full, permission denied, etc. The in-memory value
          // stays authoritative for this process -- the next write is the retry.
        }
      });
      return mutex;
    },
  };
}
