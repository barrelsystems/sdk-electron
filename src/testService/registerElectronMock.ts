// Preloaded via `--import` before the main entry's own static imports
// resolve -- registering this hook from inside the entry file itself
// would run too late, since ESM hoists imports.
import { registerHooks } from "node:module";
import type { ResolveFnOutput, ResolveHookContext } from "node:module";

registerHooks({
  resolve(
    specifier: string,
    context: ResolveHookContext,
    nextResolve: (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput,
  ): ResolveFnOutput {
    if (
      context.parentURL?.endsWith("/src/index.ts") &&
      (specifier === "./cadence.js" || specifier === "./hostControl.js")
    ) {
      return { url: new URL("./runtimeCapture.ts", import.meta.url).href, shortCircuit: true };
    }

    if (specifier === "electron-updater") {
      if (process.env["BARREL_TEST_VARIANT"] === "builtin") throw new Error("optional peer absent");
      return {
        url: new URL("./fakeElectronUpdater.cjs", import.meta.url).href,
        shortCircuit: true,
      };
    }

    if (specifier === "electron-squirrel-startup") {
      return { url: new URL("./fakeSquirrel.ts", import.meta.url).href, shortCircuit: true };
    }

    if (specifier === "electron") {
      return { url: new URL("./fakeElectron.ts", import.meta.url).href, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});
