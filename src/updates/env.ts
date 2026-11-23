import { app } from "electron";
import os from "node:os";

export interface Environment {
  observedVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
}

export function collectEnvironment(): Environment {
  return {
    observedVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
  };
}
