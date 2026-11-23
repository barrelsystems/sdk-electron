import { runtime } from "./updates/runtime.js";
import type { InitConfig } from "./initConfig.js";

/** Initialize once in the main process, before creating windows. */
export function init(config: InitConfig): void {
  runtime.init(config);
}

export type { InitConfig } from "./initConfig.js";
export { BarrelConfigError } from "./errors.js";
export * as Updates from "./updates/index.js";
