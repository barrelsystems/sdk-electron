import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { waitForInstallationIdPersistence } from "../updates/persistence/installationId.js";
import { app, powerMonitor } from "./fakeElectron.js";
import { cadence } from "./runtimeCapture.js";

const debugMessages: string[] = [];

export function captureDebugMessages(): void {
  console.debug = (...values: unknown[]) => {
    debugMessages.push(values.map(String).join(" "));
  };
}

export function cadenceState(): unknown {
  return {
    intervalMs: cadence?.intervalMs ?? null,
    inFlight: cadence?.inFlight ?? false,
    logs: [...debugMessages],
    lifecycleEvents: ["foreground", "resume"],
  };
}

export function triggerLifecycle(event: "foreground" | "resume"): void {
  if (event === "foreground") app.emit("browser-window-focus");
  else powerMonitor.emit("resume");
}

function installationPath(): string {
  const directory = process.env["BARREL_TEST_DATA_DIR"];
  if (!directory) throw new Error("isolated storage unavailable");

  return join(directory, "barrel-installation.json");
}

export async function restoreInstallationPersistence(): Promise<null> {
  await rm(installationPath(), { recursive: true, force: true });
  return null;
}

export async function getPersistedInstallationId(): Promise<string | null> {
  await waitForInstallationIdPersistence();
  try {
    const persisted = JSON.parse(await readFile(installationPath(), "utf8")) as {
      installationId: string;
    };
    return persisted.installationId;
  } catch {
    return null;
  }
}
