import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface PersistenceWriter {
  persist(): Promise<void>;
  waitForPendingWrites(): Promise<void>;
}

export async function writeSnapshot(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const pendingPath = `${path}.pending`;
  await writeFile(pendingPath, data, "utf8");
  // Commit without yielding: an exit snapshot cannot be overwritten by an
  // older asynchronous write still targeting this separate staging file.
  renameSync(pendingPath, path);
}

export function createPersistenceWriter(
  getPath: () => string | undefined,
  getSnapshot: () => unknown,
  options: { writeSnapshot?: (path: string, data: string) => Promise<void> } = {},
): PersistenceWriter {
  const write = options.writeSnapshot ?? writeSnapshot;
  let pending: { path: string; data: string } | undefined;
  let draining: Promise<void> | undefined;

  async function drain(): Promise<void> {
    while (pending !== undefined) {
      const job = pending;
      pending = undefined;

      try {
        await write(job.path, job.data);
      } catch {
        // Memory remains authoritative; the next observation retries.
      }
    }

    draining = undefined;
  }

  // Exit permits only synchronous work, including the latest unsaved value.
  process.once("exit", () => {
    try {
      const path = getPath();
      if (path === undefined) return;

      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(getSnapshot()), "utf8");
    } catch {
      // No further recovery is possible during process teardown.
    }
  });

  return {
    waitForPendingWrites: () => draining ?? Promise.resolve(),
    persist(): Promise<void> {
      try {
        const path = getPath();
        if (path === undefined) return Promise.resolve();

        const data = JSON.stringify(getSnapshot());
        if (data === undefined) return Promise.resolve();

        // Complete snapshots supersede queued snapshots without growing a backlog.
        pending = { path, data };
        draining ??= Promise.resolve().then(drain);
        return draining;
      } catch {
        return Promise.resolve();
      }
    },
  };
}
