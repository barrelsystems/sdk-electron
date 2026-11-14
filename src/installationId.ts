import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

let cachedInstallationId: string | undefined;
let persistedToDisk = false;
// Serializes concurrent callers onto one in-flight resolution instead of a
// lock object -- Node has no shared memory for a real mutex to guard here.
let pending: Promise<string> | undefined;

/**
 * Reads the persisted installation ID, or generates and persists a fresh
 * one. Every I/O call is async and fails open — a write failure keeps the
 * in-memory ID for this process's lifetime rather than regenerating.
 */
export async function getOrCreateInstallationId(filePath: string): Promise<string> {
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
    persistedToDisk = true;
    return cachedInstallationId;
  }

  cachedInstallationId = randomUUID();
  registerExitFallback(filePath);
  await persist(filePath, cachedInstallationId);
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

async function persist(filePath: string, installationId: string): Promise<void> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ installationId }), "utf8");
    persistedToDisk = true;
  } catch {
    // Fail open: disk full, permission denied, etc. The in-memory ID generated
    // above is still returned and used for this process's lifetime. There is
    // no dedicated retry loop — the next call into this module is the retry.
  }
}

// A fact observed right before exit must still land on disk -- 'exit' only
// allows synchronous work, so this is the one place a sync fs call belongs.
function registerExitFallback(filePath: string): void {
  process.once("exit", () => {
    if (persistedToDisk || cachedInstallationId === undefined) return;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify({ installationId: cachedInstallationId }), "utf8");
    } catch {
      // Nothing more can be done once the process is already exiting.
    }
  });
}
