import type { Config } from "./updates/models/configuration.js";

export interface InitConfig {
  credential: string;
  baseUrl?: string;
  debug?: boolean;
  updates?: Config;
}
