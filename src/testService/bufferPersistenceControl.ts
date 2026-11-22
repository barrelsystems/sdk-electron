import { mkdir, rm } from "node:fs/promises";
import { basename } from "node:path";
import { waitForBufferedFactsPersistence } from "../persistence/bufferedFacts.js";

type Mode = "normal" | "blocked" | "failed";
let mode: Mode = "normal";
let waiting = false;
let release: (() => void) | undefined;
let gate: Promise<void> | undefined;

export async function beforeBufferWrite(path: string): Promise<void> {
  if (basename(path) !== "barrel-buffered-facts.json" || !gate) return;

  waiting = true;
  await gate;
  waiting = false;
}

export function blockedBufferWrite(): boolean {
  return waiting;
}

export async function setBufferPersistence(path: string, next: Mode): Promise<void> {
  release?.();
  gate = undefined;
  release = undefined;
  await waitForBufferedFactsPersistence();

  if (mode === "failed") await rm(path, { recursive: true, force: true });
  if (next === "failed") {
    await rm(path, { force: true });
    await mkdir(path, { recursive: true });
  }

  mode = next;
  if (next === "blocked")
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
}
