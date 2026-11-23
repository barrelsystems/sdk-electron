import { readFile } from "node:fs/promises";
import type { UpdateState } from "../models/state.js";
import type { UpdateFailure } from "../models/failure.js";
import { isReportableUpdateState } from "../models/state.js";
import { createPersistenceWriter, type PersistenceWriter } from "./persistenceWriter.js";

const MAX_BUFFERED_FACTS = 32;
const TERMINAL_ADAPTER_STATES = new Set<UpdateState["type"]>([
  "downloaded",
  "applying",
  "failed",
  "update-cancelled",
]);

export interface FactTimestamps {
  firstObservedAt: string;
  lastObservedAt: string;
  occurrenceCount: number;
}

/** `title` is a pure, derived function of `failureMode` -- MUST NEVER be
 * persisted or transmitted, so this variant stores everything else instead
 * of the whole `UpdateFailure`. */
export type PersistedUpdateFailure = Omit<UpdateFailure, "title">;

export type BufferedFact =
  | ({ kind: "lifecycleState"; state: UpdateState } & FactTimestamps)
  | ({ kind: "updateError"; failure: PersistedUpdateFailure } & FactTimestamps);

let buffer: BufferedFact[] = [];
let filePath: string | undefined;

let store: PersistenceWriter | undefined;

/** Hydrates the in-memory buffer from disk. Call once at startup, before any fact is recorded. */
export async function configureBufferedFacts(
  path: string,
  options: { writeSnapshot?: (path: string, data: string) => Promise<void> } = {},
): Promise<void> {
  filePath = path;
  store ??= createPersistenceWriter(
    () => filePath,
    () => ({ facts: buffer }),
    options,
  );

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

/** Clears exactly the facts in `sent` (a snapshot `getBufferedFacts()` returned earlier) -- call only once
 * ingestion ACKs that check-in, never optimistically: a fact recorded while it was still in flight must
 * survive. */
export function clearBufferedFacts(sent: readonly BufferedFact[]): void {
  buffer = buffer.filter((fact) => !sent.includes(fact));
  void store?.persist();
}

/** Appends an observed adapter-state transition, or merges it into a matching last entry. */
export function recordLifecycleStateFact(state: UpdateState): void {
  // `checking` is SDK-activity, never installation state -- it must never
  // reach the backend, including historically through a buffered fact.
  if (!isReportableUpdateState(state)) return;

  const now = new Date().toISOString();
  upsert({
    kind: "lifecycleState",
    state,
    firstObservedAt: now,
    lastObservedAt: now,
    occurrenceCount: 1,
  });
}

/** Appends an observed update error, or merges it into a matching last entry.
 * Strips `title` before storing -- it's never persisted, only derived at read time. */
export function recordUpdateErrorFact(failure: UpdateFailure): void {
  const { title: _title, ...persisted } = failure;
  const now = new Date().toISOString();
  upsert({
    kind: "updateError",
    failure: persisted,
    firstObservedAt: now,
    lastObservedAt: now,
    occurrenceCount: 1,
  });
}

/** The most recently observed buffered `updateError` fact, if any -- the crash-recovery fallback
 * `getLastUpdateError()` uses when the adapter has no in-memory failure of its own. */
export function getLastBufferedUpdateError(): PersistedUpdateFailure | undefined {
  let latest: (BufferedFact & { kind: "updateError" }) | undefined;

  for (const fact of buffer) {
    if (fact.kind !== "updateError") continue;
    if (latest === undefined || fact.lastObservedAt >= latest.lastObservedAt) latest = fact;
  }

  return latest?.failure;
}

interface FactClassification {
  discriminant: string;
  priority: 0 | 1;
}

function classify(fact: BufferedFact): FactClassification {
  if (fact.kind === "updateError")
    return {
      discriminant: `updateError:${JSON.stringify([fact.failure.phase, fact.failure.failureMode, fact.failure.platform, fact.failure.platformCode])}`,
      priority: 1,
    };

  const state = fact.state;
  if (state.type === "failed")
    return {
      discriminant: `lifecycleState:failed:${JSON.stringify([state.category, state.code, state.platformCode])}`,
      priority: 1,
    };

  const detail =
    "progress" in state ? state.progress : "releaseNotes" in state ? state.releaseNotes : undefined;

  return {
    discriminant: `lifecycleState:${JSON.stringify([state.type, detail])}`,
    priority: TERMINAL_ADAPTER_STATES.has(state.type) ? 1 : 0,
  };
}

/** Merges only adjacent observations with identical discriminating fields. */
function upsert(candidate: BufferedFact): void {
  const { discriminant, priority } = classify(candidate);
  const existingIndex = buffer.length - 1;
  const existing = existingIndex === -1 ? undefined : buffer[existingIndex];

  if (existing !== undefined && classify(existing).discriminant === discriminant) {
    buffer[existingIndex] = {
      ...candidate,
      firstObservedAt: existing.firstObservedAt,
      occurrenceCount: existing.occurrenceCount + 1,
    };
    void store?.persist();
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
  void store?.persist();
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

export function waitForBufferedFactsPersistence(): Promise<void> {
  return store?.waitForPendingWrites() ?? Promise.resolve();
}
