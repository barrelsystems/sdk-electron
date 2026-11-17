import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDiskStore } from "./diskStore.js";

let cachedInstallationId: string | undefined;
let currentFilePath: string | undefined;
// Serializes concurrent callers onto one in-flight resolution instead of a
// lock object -- Node has no shared memory for a real mutex to guard here.
let pending: Promise<string> | undefined;

const store = createDiskStore(
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
  if (cachedInstallationId !== undefined) return cachedInstallationId;

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
  await store.persist();
  return cachedInstallationId;
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
