import { readFile } from "node:fs/promises";
import type { AdapterState, UpdateFailure } from "../types.js";
import { createDiskStore } from "./diskStore.js";

const MAX_BUFFERED_FACTS = 32;
const TERMINAL_ADAPTER_STATES = new Set<AdapterState["type"]>([
  "downloaded",
  "failed",
  "update-cancelled",
]);

interface FactTimestamps {
  firstObservedAt: string;
  lastObservedAt: string;
  occurrenceCount: number;
}

export type BufferedFact =
  | ({ kind: "adapterState"; state: AdapterState } & FactTimestamps)
  | ({ kind: "updateError"; failure: UpdateFailure } & FactTimestamps);

let buffer: BufferedFact[] = [];
let filePath: string | undefined;

const store = createDiskStore(
  () => filePath,
  () => ({ facts: buffer }),
);

/** Hydrates the in-memory buffer from disk. Call once at startup, before any fact is recorded. */
export async function configureBufferedFacts(path: string): Promise<void> {
  filePath = path;

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { facts?: BufferedFact[] };
    buffer = parsed.facts ?? [];
  } catch {
    // No prior buffer on disk, or it's unreadable -- start empty, same as a fresh install.
  }
}

/** A snapshot of the current facts, for inclusion in a check-in request. Never the live buffer. */
export function getBufferedFacts(): readonly BufferedFact[] {
  return [...buffer];
}

/**
 * Clears exactly the facts in `sent` (a snapshot `getBufferedFacts()` returned
 * earlier) -- call only once ingestion ACKs the check-in that carried them,
 * never optimistically, and never a bare clear-everything: a fact recorded
 * after `sent` was taken (e.g. while that check-in was still in flight) was
 * never actually transmitted, so it must survive. Reference equality is
 * enough to tell the two apart, since a merge always replaces a fact's slot
 * with a new object rather than mutating it in place.
 */
export function clearBufferedFacts(sent: readonly BufferedFact[]): void {
  buffer = buffer.filter((fact) => !sent.includes(fact));
  void store.persist();
}

/** Appends an observed adapter-state transition, or merges it into a matching existing entry. */
export function recordAdapterStateFact(state: AdapterState): void {
  const now = new Date().toISOString();
  upsert({
    kind: "adapterState",
    state,
    firstObservedAt: now,
    lastObservedAt: now,
    occurrenceCount: 1,
  });
}

/** Appends an observed update error, or merges it into a matching existing entry. */
export function recordUpdateErrorFact(failure: UpdateFailure): void {
  const now = new Date().toISOString();
  upsert({
    kind: "updateError",
    failure,
    firstObservedAt: now,
    lastObservedAt: now,
    occurrenceCount: 1,
  });
}

interface FactClassification {
  discriminant: string;
  priority: 0 | 1;
}

function classify(fact: BufferedFact): FactClassification {
  if (fact.kind === "updateError")
    return {
      discriminant: `updateError:${fact.failure.failureMode}:${fact.failure.platformCode}`,
      priority: 1,
    };

  const state = fact.state;
  if (state.type === "failed")
    return { discriminant: `adapterState:failed:${state.code}:${state.platformCode}`, priority: 1 };

  return {
    discriminant: `adapterState:${state.type}`,
    priority: TERMINAL_ADAPTER_STATES.has(state.type) ? 1 : 0,
  };
}

/** Merges `candidate` into a matching existing entry (same kind + discriminant,
 * wherever it sits in the buffer), or inserts it as new. */
function upsert(candidate: BufferedFact): void {
  const { discriminant, priority } = classify(candidate);
  const existingIndex = buffer.findIndex((fact) => classify(fact).discriminant === discriminant);
  const existing = existingIndex === -1 ? undefined : buffer[existingIndex];

  if (existingIndex !== -1 && existing !== undefined) {
    buffer[existingIndex] = {
      ...candidate,
      firstObservedAt: existing.firstObservedAt,
      occurrenceCount: existing.occurrenceCount + 1,
    };
    void store.persist();
    return;
  }

  if (buffer.length >= MAX_BUFFERED_FACTS) {
    const evictionIndex = findEvictionCandidateIndex();
    const toEvict = evictionIndex === undefined ? undefined : buffer[evictionIndex];
    if (evictionIndex === undefined || toEvict === undefined) return;

    // A full buffer of terminal facts is never displaced by an incoming
    // intermediate one -- the incoming fact is dropped instead.
    if (classify(toEvict).priority > priority) return;
    buffer.splice(evictionIndex, 1);
  }

  buffer.push(candidate);
  void store.persist();
}

function findEvictionCandidateIndex(): number | undefined {
  let worstIndex: number | undefined;

  for (let index = 0; index < buffer.length; index++) {
    const fact = buffer[index];
    if (fact === undefined) continue;

    const worst = worstIndex === undefined ? undefined : buffer[worstIndex];
    if (worstIndex === undefined || worst === undefined) {
      worstIndex = index;
      continue;
    }

    const factPriority = classify(fact).priority;
    const worstPriority = classify(worst).priority;
    const isWorse =
      factPriority < worstPriority ||
      (factPriority === worstPriority && fact.lastObservedAt < worst.lastObservedAt);
    if (isWorse) worstIndex = index;
  }

  return worstIndex;
}
