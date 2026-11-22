import { createServer } from "node:http";
import { TestServiceHttpApi } from "@barrel-kit/sdk-conformance-harness";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { RoutesLayer } from "./routes.js";
import { runBufferExitProbe } from "./bufferExitProbe.js";

const probeConfig = process.env["BARREL_BUFFER_PROBE"];
if (probeConfig) await runBufferExitProbe(probeConfig);

const program = Effect.gen(function* () {
  const portDeferred = yield* Deferred.make<number>();

  const PortSignalLayer = Layer.effectDiscard(
    Effect.gen(function* () {
      const server = yield* HttpServer.HttpServer;
      const port = server.address._tag === "UnixPathAddress" ? 0 : server.address.port;

      yield* Deferred.succeed(portDeferred, port);
    }),
  );

  const ApiLayer = HttpApiBuilder.layer(TestServiceHttpApi).pipe(
    Layer.provide(RoutesLayer),
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
