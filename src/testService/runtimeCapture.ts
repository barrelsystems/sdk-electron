import { startCadence as start, type Cadence, type CadenceParams } from "../updates/cadence.js";
import {
  startHostControl as control,
  type HostControl,
  type HostControlParams,
} from "../updates/hostControl.js";
import { configureBufferedFacts } from "../updates/persistence/bufferedFacts.js";
import { createRuntime } from "../updates/runtime.js";
import { writeBufferSnapshot } from "./bufferPersistenceControl.js";

export let cadence: Cadence | undefined;
export let hostControl: HostControl | undefined;

function startCadence(params: CadenceParams): Cadence {
  cadence = start(params);
  return cadence;
}

function startHostControl(params: HostControlParams): HostControl {
  hostControl = control(params);
  return hostControl;
}

export const sdk = createRuntime({
  startCadence,
  startHostControl,
  configureBufferedFacts: (path) =>
    configureBufferedFacts(path, { writeSnapshot: writeBufferSnapshot }),
});
