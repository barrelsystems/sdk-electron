import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runBufferCommand } from "./bufferCommands.js";
import * as sdk from "../index.js";
import { cadence, hostControl } from "./runtimeCapture.js";
import { activity, autoUpdater, prepareAction } from "./fakeElectron.js";
import type { AdapterCommand, CreateAdapterRequest } from "@barrel-kit/sdk-conformance-harness";

Object.assign(globalThis, { __SDK_VERSION__: "0.0.1" });
Object.defineProperty(process, "type", { value: "browser" });

export async function command(payload: AdapterCommand): Promise<unknown> {
  switch (payload.command) {
    case "setBufferPersistence":
    case "getBufferPersistenceState":
    case "recordFacts":
    case "getBufferedFacts":
    case "clearBuffer":
    case "getPersistedBuffer":
      return runBufferCommand(payload);
    case "probeBufferExit":
      throw new Error("exit probes run in their own process");
    case "getPolicy":
      return sdk.getPolicy() ?? null;
    case "getAdapterState":
      return sdk.getAdapterState() ?? null;
    case "getLastUpdateError":
      return sdk.getLastUpdateError() ?? null;
    case "getUpdaterActivity":
      return { ...activity };
    case "checkNow":
      await cadence?.checkNow();
      await hostControl?.settled();
      return null;
    case "prepareAction":
      prepareAction(payload.stage);
      await hostControl?.settled();
      return null;
    case "runAction":
      if (payload.stage === "pre-download") sdk.downloadUpdate();
      else sdk.applyUpdate();
      await hostControl?.settled();
      return { ...activity };
    case "injectEvent":
      autoUpdater.emit(
        payload.eventName,
        ...(Array.isArray(payload.payload) ? payload.payload : []),
      );
      await hostControl?.settled();
      return null;
  }
}

export async function initialize(config: CreateAdapterRequest): Promise<void> {
  const directory = process.env["BARREL_TEST_DATA_DIR"];
  if (!directory) throw new Error("worker requires an isolated data directory");

  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "barrel-trusted-key.json"),
    JSON.stringify({ publicKeyPem: config.publicKeyPem }),
  );
  sdk.init({
    credential: "test-service",
    baseUrl: config.checkInBaseUrl,
    channel: config.channel ?? "stable",
    autoDownload: false,
  });

  while (!cadence) await new Promise<void>((resolve) => setTimeout(resolve, 1));
  await cadence.ready;
  process.send?.({ ready: true });
}
