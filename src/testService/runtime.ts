import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cadenceState,
  captureDebugMessages,
  restoreInstallationPersistence,
  getPersistedInstallationId,
  triggerLifecycle,
} from "./resilienceCommands.js";
import { runBufferCommand } from "./bufferCommands.js";
import { sdk, cadence, hostControl } from "./runtimeCapture.js";
import { activity, autoUpdater, prepareAction } from "./fakeElectron.js";
import type { AdapterCommand, CreateAdapterRequest } from "@barrel-kit/sdk-conformance-harness";

Object.assign(globalThis, { __SDK_VERSION__: "0.0.1" });
Object.defineProperty(process, "type", { value: "browser" });

export async function command(payload: AdapterCommand): Promise<unknown> {
  switch (payload.command) {
    case "prepareUpdaterFailure":
      autoUpdater.emit("error", new Error("fixture updater failure"));
      await hostControl?.settled();
      return null;
    case "getCadenceState":
      return cadenceState();
    case "triggerLifecycle":
      triggerLifecycle(payload.event);
      return null;
    case "getPersistedInstallationId":
      return getPersistedInstallationId();
    case "restoreInstallationPersistence":
      return restoreInstallationPersistence();
    case "setBufferPersistence":
    case "getBufferPersistenceState":
    case "recordFacts":
    case "getBufferedFacts":
    case "clearBuffer":
    case "getPersistedBuffer":
      return runBufferCommand(payload);
    case "probeBufferExit":
      throw new Error("exit probes run in their own process");
    case "getUpdateEligibility":
      return sdk.getStatus().eligibility ?? null;
    case "getUpdateState":
      return sdk.getStatus().state;
    case "getLastUpdateError":
      return sdk.getStatus().lastError ?? null;
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
      // The command endpoint reports action outcomes through state and activity instead of
      // HTTP errors.
      if (payload.stage === "pre-download") await sdk.download().catch(() => {});
      else await sdk.apply().catch(() => {});
      await hostControl?.settled();
      return { ...activity };
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
  if (config.installationPersistence === "failed") {
    await mkdir(join(directory, "barrel-installation.json"));
  }
  captureDebugMessages();
  sdk.init({
    credential: "test-service",
    baseUrl: config.checkInBaseUrl,
    ...(config.debug === undefined ? {} : { debug: config.debug }),
    updates: {
      channel: config.channel ?? "stable",
      autoDownload: false,
      ...(config.attributes === undefined ? {} : { attributes: config.attributes }),
      ...(config.checkInIntervalMs === undefined
        ? {}
        : { checkInIntervalMs: config.checkInIntervalMs }),
    },
  });

  while (!cadence) await new Promise<void>((resolve) => setTimeout(resolve, 1));
  await cadence.ready;
  process.send?.({ ready: true });
}
