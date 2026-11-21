import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { release } from "node:os";
import { TestServiceHttpApi } from "@barrel-kit/sdk-conformance-harness";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { HttpApiBuilder } from "effect/http-api";
import type { ElectronUpdaterLike, UpdaterAdapter } from "../adapters/electronUpdaterAdapter.js";
import { createUpdaterAdapter } from "../adapters/createUpdaterAdapter.js";
import { autoUpdater as fakeBuiltinAutoUpdater, createFakeEmitter } from "./fakeElectron.js";
import { computeJitterFraction } from "../jitter.js";
import { sendCheckIn } from "../protocol/checkIn.js";
import { checkPreAction } from "../protocol/preActionCheck.js";
import { verifyAndParsePolicy } from "../protocol/policy.js";
import type { BackendConnection } from "../types.js";
import type { Capabilities } from "./wireTypes.js";

/** The mock backend accepts any bearer value -- this test service has no
 * credential of its own to configure, only `checkInBaseUrl`/`publicKeyPem`. */
const TEST_SERVICE_CREDENTIAL = "test-service";

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
  readonly installationId: string;
  readonly checkInBaseUrl: string;
  readonly publicKeyPem: string;
  /** Mirrors `cadence.ts`'s own tick: a `checkNow` that arrives while one is
   * already in flight for this instance is skipped, not queued, so it never
   * performs a second real check-in. */
  checkInFlight: boolean;
}

/** Routes through the real selection logic, exercising the real
 * electron-updater-vs-builtin fallback -- the builtin variant's `load`
 * throws to force it, matching a missing peer dependency in production. */
async function createAdapterForVariant(
  variant: string | undefined,
): Promise<Pick<AdapterInstance, "fakeUpdater" | "adapter">> {
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

const capabilities: Capabilities = {
  sdkName: "electron",
  sdkVersion: "0.0.1",
  supportsCheckIn: true,
};

export const RoutesLayer = Layer.unwrap(
  Effect.gen(function* () {
    const adapters = yield* Ref.make<Map<string, AdapterInstance>>(new Map());

    return HttpApiBuilder.group(TestServiceHttpApi, "testService", (handlers) =>
      handlers
        .handle("capabilities", () => Effect.succeed(capabilities))
        .handle("createAdapter", ({ payload }) =>
          Effect.gen(function* () {
            const id = randomUUID();
            const { fakeUpdater, adapter } = yield* Effect.promise(() =>
              createAdapterForVariant(payload.variant),
            );

            yield* Ref.update(adapters, (map) => {
              const next = new Map(map);

              next.set(id, {
                fakeUpdater,
                adapter,
                installationId: randomUUID(),
                checkInBaseUrl: payload.checkInBaseUrl,
                publicKeyPem: payload.publicKeyPem,
                checkInFlight: false,
              });

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

            const connection: BackendConnection = {
              baseUrl: instance.checkInBaseUrl,
              credential: TEST_SERVICE_CREDENTIAL,
              installationId: instance.installationId,
            };

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
              case "checkNow": {
                // Exercises the check-in call itself, same as a scheduled
                // tick -- never drives `instance.adapter`'s own lifecycle
                // state, which stays whatever `injectEvent` scenarios expect.
                if (instance.checkInFlight) return { result: null };
                instance.checkInFlight = true;

                try {
                  const response = yield* Effect.promise(() =>
                    sendCheckIn({
                      connection,
                      sdkVersion: capabilities.sdkVersion,
                      observedVersion: capabilities.sdkVersion,
                      platform: process.platform,
                      arch: process.arch,
                      osVersion: release(),
                      attributes: {},
                      adapterState: instance.adapter.getAdapterState(),
                      bufferedFacts: [],
                    }),
                  );

                  // Resolved but discarded: no scenario asserts on `checkNow`'s
                  // own return value, and the sibling test services all respond
                  // with no policy here too -- `getAdapterState` is checked instead.
                  if (response) verifyAndParsePolicy(response, instance.publicKeyPem);
                } finally {
                  instance.checkInFlight = false;
                }

                return { result: null };
              }
              case "triggerPreActionCheck": {
                const policy = yield* Effect.promise(() =>
                  checkPreAction({
                    connection,
                    stage: payload.stage,
                    trustedKeyPem: instance.publicKeyPem,
                  }),
                );

                // A failed/unresolved pre-action-check fails open, exactly as
                // a "current" policy would -- so that's the string reported here.
                return { result: policy?.type ?? "current" };
              }
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
  }),
);
