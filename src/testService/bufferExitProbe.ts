import { writeBufferSnapshot } from "./bufferPersistenceControl.js";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FactObservation } from "@barrel-kit/sdk-conformance-harness";

import {
  configureBufferedFacts,
  getBufferedFacts,
  waitForBufferedFactsPersistence,
} from "../updates/persistence/bufferedFacts.js";
import { recordObservation } from "./bufferCommands.js";
import { blockedBufferWrite, setBufferPersistence } from "./bufferPersistenceControl.js";

async function runProbe(config: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let result: unknown;
    const child = fork(fileURLToPath(new URL("./main.ts", import.meta.url)), [], {
      env: { ...process.env, BARREL_BUFFER_PROBE: JSON.stringify(config) },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    child.on("message", (message) => {
      result = message;
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve(result) : reject(new Error(`buffer probe exited: ${code}`)),
    );
  });
}

export async function probeBufferExit(
  mode: "settled" | "pending",
  facts: readonly FactObservation[],
): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), "barrel-buffer-exit-"));

  try {
    const pendingWriteObserved = await runProbe({ directory, facts, mode, reload: false });
    const persisted = JSON.parse(
      await readFile(join(directory, "barrel-buffered-facts.json"), "utf8"),
    ) as object;
    const recoveredFacts = await runProbe({ directory, facts, mode, reload: true });
    return { ...persisted, recoveredFacts, pendingWriteObserved };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runBufferExitProbe(config: string): Promise<void> {
  const { directory, facts, mode, reload } = JSON.parse(config) as {
    directory: string;
    mode: "settled" | "pending";
    reload: boolean;
    facts: FactObservation[];
  };
  const path = join(directory, "barrel-buffered-facts.json");
  await configureBufferedFacts(path, { writeSnapshot: writeBufferSnapshot });
  if (reload) {
    await send(getBufferedFacts());
    process.exit(0);
  }

  if (mode === "pending") await setBufferPersistence(path, "blocked");
  for (const fact of facts) recordObservation(fact);
  if (mode === "pending") {
    const deadline = Date.now() + 2000;
    while (!blockedBufferWrite() && Date.now() < deadline)
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    if (!blockedBufferWrite()) throw new Error("writer did not reach the gate");
  } else {
    await waitForBufferedFactsPersistence();
    // Only the production exit handler can recreate the removed file.
    await unlink(path);
  }
  await send(mode === "pending");
  process.exit(0);
}

async function send(value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.send?.(value, (error) => (error ? reject(error) : resolve()));
  });
}
