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
    if (specifier === "electron") {
      return { url: new URL("./fakeElectron.ts", import.meta.url).href, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});
