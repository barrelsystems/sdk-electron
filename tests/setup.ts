import { afterEach, beforeEach } from "vitest";

let existing: Set<(...args: unknown[]) => void>;

beforeEach(() => {
  existing = new Set(process.listeners("exit"));
});
afterEach(() => {
  for (const listener of process.listeners("exit")) {
    if (!existing.has(listener)) process.removeListener("exit", listener);
  }
});
