import { startCadence as start, type Cadence, type CadenceParams } from "../cadence.js";
import {
  startHostControl as control,
  type HostControl,
  type HostControlParams,
} from "../hostControl.js";

export * from "../cadence.js";
export * from "../hostControl.js";

export let cadence: Cadence | undefined;
export let hostControl: HostControl | undefined;

export function startCadence(params: CadenceParams): Cadence {
  cadence = start(params);
  return cadence;
}

export function startHostControl(params: HostControlParams): HostControl {
  hostControl = control(params);
  return hostControl;
}
