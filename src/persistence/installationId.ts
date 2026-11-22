import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createPersistenceWriter } from "./persistenceWriter.js";

let cachedInstallationId: string | undefined;
let currentFilePath: string | undefined;
// Serializes concurrent callers onto one in-flight resolution instead of a
// lock object -- Node has no shared memory for a real mutex to guard here.
let pending: Promise<string> | undefined;
let pendingPersistence: Promise<void> | undefined;

const store = createPersistenceWriter(
  () => currentFilePath,
  () => ({ installationId: cachedInstallationId }),
);

/**
 * Reads the persisted installation ID, or generates and persists a fresh
 * one. Every I/O call is async and fails open — a write failure keeps the
 * in-memory ID for this process's lifetime rather than regenerating.
 */
export async function getOrCreateInstallationId(filePath: string): Promise<string> {
  currentFilePath = filePath;
  if (cachedInstallationId !== undefined) {
    retryInstallationIdPersistence();
    await waitForInstallationIdPersistence();
    return cachedInstallationId;
  }

  pending ??= resolveInstallationId(filePath).finally(() => {
    pending = undefined;
  });
  return pending;
}

async function resolveInstallationId(filePath: string): Promise<string> {
  const existing = await readExisting(filePath);
  if (existing !== undefined) {
    cachedInstallationId = existing;
    return cachedInstallationId;
  }

  cachedInstallationId = randomUUID();
  retryInstallationIdPersistence();
  await waitForInstallationIdPersistence();
  return cachedInstallationId;
}

/** Schedules one background save; a later check-in retries if this attempt fails. */
export function retryInstallationIdPersistence(): void {
  if (cachedInstallationId === undefined || pendingPersistence !== undefined) return;

  pendingPersistence = store.persist().finally(() => {
    pendingPersistence = undefined;
  });
}

export function waitForInstallationIdPersistence(): Promise<void> {
  return pendingPersistence ?? Promise.resolve();
}

async function readExisting(filePath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { installationId?: string };
    return parsed.installationId;
  } catch {
    return undefined;
  }
}
