import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TestServiceHttpApi,
  type AdapterCommand,
  type CreateAdapterRequest,
} from "@barrel-kit/sdk-conformance-harness";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApiBuilder, type HttpApiGroup } from "effect/http-api";
import { probeBufferExit } from "./bufferExitProbe.js";
import { computeJitterFraction } from "../updates/jitter.js";

interface Worker {
  child: ChildProcess;
  directory: string;
  command(payload: AdapterCommand): Promise<unknown>;
}

async function createWorker(config: CreateAdapterRequest): Promise<Worker> {
  const directory = await mkdtemp(join(tmpdir(), "barrel-test-service-"));
  const child = fork(fileURLToPath(new URL("./worker.ts", import.meta.url)), [], {
    env: {
      ...process.env,
      BARREL_TEST_DATA_DIR: directory,
      BARREL_TEST_CONFIG: JSON.stringify(config),
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let markReady: () => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    rejectReady = reject;
  });

  child.on(
    "message",
    (message: { ready?: boolean; id?: number; result?: unknown; error?: string }) => {
      if (message.ready) {
        markReady();
        return;
      }
      if (message.id === undefined) return;

      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(message.error));
      else request?.resolve(message.result ?? null);
    },
  );
  child.on("exit", () => {
    const error = new Error("SDK worker exited");
    rejectReady(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });
  child.on("error", rejectReady);

  try {
    await ready;
  } catch (error) {
    child.kill();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    child,
    directory,
    command(payload) {
      return new Promise((resolve, reject) => {
        const id = sequence++;
        pending.set(id, { resolve, reject });
        child.send({ id, payload });
      });
    },
  };
}

export const RoutesLayer: Layer.Layer<HttpApiGroup.Service<"sdk-test-service", "testService">> =
  Layer.unwrap(
    Effect.sync(() => {
      const workers = new Map<string, Worker>();

      return HttpApiBuilder.group(TestServiceHttpApi, "testService", (handlers) =>
        handlers
          .handle("capabilities", () =>
            Effect.succeed({ sdkName: "electron", sdkVersion: "0.0.1", supportsCheckIn: true }),
          )
          .handle("createAdapter", ({ payload }) =>
            Effect.promise(async () => {
              const worker = await createWorker(payload);
              const id = randomUUID();
              workers.set(id, worker);
              return { id };
            }),
          )
          .handle("runCommand", ({ params, payload }) =>
            Effect.promise(async () => {
              if (payload.command === "probeBufferExit")
                return { result: await probeBufferExit(payload.mode, payload.facts) };
              const worker = workers.get(params.id);
              if (!worker) throw new Error("unknown SDK worker");
              return { result: await worker.command(payload) };
            }),
          )
          .handle("destroyAdapter", ({ params }) =>
            Effect.promise(async () => {
              const worker = workers.get(params.id);
              if (!worker) return;
              workers.delete(params.id);
              if (worker.child.exitCode === null && worker.child.signalCode === null) {
                await new Promise<void>((resolve) => {
                  worker.child.once("exit", () => resolve());
                  worker.child.kill();
                });
              }
              await rm(worker.directory, { recursive: true, force: true });
            }),
          )
          .handle("jitterFraction", ({ payload }) =>
            Effect.succeed({ fraction: computeJitterFraction(payload.installationId) }),
          ),
      );
    }),
  );
