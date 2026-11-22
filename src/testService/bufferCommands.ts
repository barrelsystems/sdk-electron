import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AdapterCommand, FactObservation } from "@barrel-kit/sdk-conformance-harness";
import {
  clearBufferedFacts,
  getBufferedFacts,
  recordAdapterStateFact,
  recordUpdateErrorFact,
  waitForBufferedFactsPersistence,
} from "../persistence/bufferedFacts.js";
import { blockedBufferWrite, setBufferPersistence } from "./bufferPersistenceControl.js";

type BufferCommand = Extract<
  AdapterCommand,
  {
    command:
      | "setBufferPersistence"
      | "getBufferPersistenceState"
      | "recordFacts"
      | "getBufferedFacts"
      | "clearBuffer"
      | "getPersistedBuffer";
  }
>;

export function recordObservation(fact: FactObservation): void {
  if (fact.kind === "adapterState") {
    if (fact.state.type === "failed") {
      if (fact.state.code !== "unknown")
        throw new Error("fact fixture requires the unknown failure code");

      recordAdapterStateFact({ ...fact.state, code: "unknown" });
    } else recordAdapterStateFact(fact.state);
  } else
    recordUpdateErrorFact({
      phase: "download",
      failureMode: "unknown",
      title: "Derived display text",
      platform: "electron-updater",
      platformCode: fact.platformCode,
    });
}

export async function runBufferCommand(payload: BufferCommand): Promise<unknown> {
  switch (payload.command) {
    case "setBufferPersistence": {
      const directory = process.env["BARREL_TEST_DATA_DIR"];
      if (!directory) throw new Error("isolated storage unavailable");
      await setBufferPersistence(join(directory, "barrel-buffered-facts.json"), payload.mode);
      return null;
    }
    case "getBufferPersistenceState":
      return { blockedWrite: blockedBufferWrite() };
    case "recordFacts":
      if (payload.concurrent)
        await Promise.all(payload.facts.map(async (fact) => recordObservation(fact)));
      else for (const fact of payload.facts) recordObservation(fact);
      return null;
    case "getBufferedFacts":
      return getBufferedFacts();
    case "clearBuffer":
      clearBufferedFacts(getBufferedFacts());
      await waitForBufferedFactsPersistence();
      return null;
    case "getPersistedBuffer": {
      await waitForBufferedFactsPersistence();
      const directory = process.env["BARREL_TEST_DATA_DIR"];
      if (!directory) throw new Error("isolated storage unavailable");
      return JSON.parse(await readFile(join(directory, "barrel-buffered-facts.json"), "utf8"));
    }
  }
}
