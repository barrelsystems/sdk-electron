import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { TestServiceHttpApi } from "@barrel-kit/sdk-conformance-harness";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { HttpServer } from "effect/http";
import { HttpRouter } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import type { ElectronUpdaterLike, UpdaterAdapter } from "../adapters/electronUpdaterAdapter.js";
import { createUpdaterAdapter } from "../adapters/createUpdaterAdapter.js";
import { autoUpdater as fakeBuiltinAutoUpdater, createFakeEmitter } from "./fakeElectron.js";
import { computeJitterFraction } from "../jitter.js";

/** A real `EventEmitter` satisfying `ElectronUpdaterLike` -- the adapter
 * under test only ever calls `.on(...)`, so the other methods here are
 * never exercised by `injectEvent`-driven scenarios and are safe no-ops. */
function createFakeUpdater(): ElectronUpdaterLike & EventEmitter {
  return createFakeEmitter({
    checkForUpdates: () => Promise.resolve(),
    downloadUpdate: () => Promise.resolve(),
    quitAndInstall: () => {},
    setFeedURL: () => {},
    autoDownload: false,
    forceDevUpdateConfig: false,
  }) as ElectronUpdaterLike & EventEmitter;
}

interface AdapterInstance {
  readonly fakeUpdater: EventEmitter;
  readonly adapter: UpdaterAdapter;
}

/** Routes through the real selection logic, exercising the real
 * electron-updater-vs-builtin fallback -- the builtin variant's `load`
 * throws to force it, matching a missing peer dependency in production. */
async function createAdapterForVariant(variant: string | undefined): Promise<AdapterInstance> {
  if (variant === "builtin") {
    const adapter = await createUpdaterAdapter(() => {
      throw new Error("test-service: forcing the built-in autoUpdater fallback");
    });

    return { fakeUpdater: fakeBuiltinAutoUpdater as unknown as EventEmitter, adapter };
  }

  const fakeUpdater = createFakeUpdater();
  const adapter = await createUpdaterAdapter(() => ({ autoUpdater: fakeUpdater }));

  return { fakeUpdater, adapter };
}

const program = Effect.gen(function* () {
  const adapters = yield* Ref.make<Map<string, AdapterInstance>>(new Map());
  const portDeferred = yield* Deferred.make<number>();

  const GroupLayer = HttpApiBuilder.group(TestServiceHttpApi, "testService", (handlers) =>
    handlers
      .handle("capabilities", () =>
        Effect.succeed({
          sdkName: "electron",
          sdkVersion: "0.0.1",
          supportsCheckIn: false,
        }),
      )
      .handle("createAdapter", ({ payload }) =>
        Effect.gen(function* () {
          const id = randomUUID();
          const { fakeUpdater, adapter } = yield* Effect.promise(() =>
            createAdapterForVariant(payload.variant),
          );

          yield* Ref.update(adapters, (map) => {
            const next = new Map(map);

            next.set(id, { fakeUpdater, adapter });

            return next;
          });

          return { id };
        }),
      )
      .handle("runCommand", ({ params, payload }) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(adapters);
          const instance = map.get(params.id);

          if (!instance)
            return yield* Effect.die(
              new Error(`electron test-service: unknown adapter ${params.id}`),
            );

          switch (payload.command) {
            case "injectEvent": {
              const args = Array.isArray(payload.payload) ? payload.payload : [];

              instance.fakeUpdater.emit(payload.eventName, ...args);

              return { result: null };
            }
            case "getAdapterState":
              return { result: instance.adapter.getAdapterState() };
            case "getLastUpdateError":
              return { result: instance.adapter.getLastUpdateError() ?? null };
            case "checkNow":
              return yield* Effect.die(
                new Error(
                  "electron test-service: checkNow is not wired -- this test service covers injectEvent-driven error-taxonomy/adapter-state conformance, not the check-in network path",
                ),
              );
          }
        }),
      )
      .handle("destroyAdapter", ({ params }) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(adapters);
          const instance = map.get(params.id);

          // The builtin variant's fake `autoUpdater` is a shared singleton;
          // without this, a destroyed adapter's listeners would keep
          // firing into the next scenario's fresh adapter.
          instance?.fakeUpdater.removeAllListeners();

          yield* Ref.update(adapters, (currentMap) => {
            const next = new Map(currentMap);

            next.delete(params.id);

            return next;
          });
        }),
      )
      .handle("jitterFraction", ({ payload }) =>
        Effect.succeed({ fraction: computeJitterFraction(payload.installationId) }),
      ),
  );

  const PortSignalLayer = Layer.effectDiscard(
    Effect.gen(function* () {
      const server = yield* HttpServer.HttpServer;
      const port = server.address._tag === "UnixPathAddress" ? 0 : server.address.port;

      yield* Deferred.succeed(portDeferred, port);
    }),
  );

  const ApiLayer = HttpApiBuilder.layer(TestServiceHttpApi).pipe(
    Layer.provide(GroupLayer),
    HttpRouter.serve,
    Layer.merge(PortSignalLayer),
    Layer.provide(NodeHttpServer.layer(createServer, { port: 0 })),
  );

  yield* Effect.forkScoped(Layer.launch(ApiLayer));
  const port = yield* Deferred.await(portDeferred);

  console.log(`electron test-service listening on http://localhost:${port}`);

  // Without this, reaching the end of this generator closes the `Effect.scoped`
  // scope below, interrupting the forked server fiber immediately.
  yield* Effect.never;
}).pipe(Effect.scoped);

NodeRuntime.runMain(program);
