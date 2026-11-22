import { readFileSync, rmSync } from "node:fs";
import { defineConfig, type Options } from "tsdown";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig((): Options[] => {
  // tsdown runs these builds concurrently, so clean the shared directory
  // before any build can emit files into it.
  rmSync(new URL("./dist", import.meta.url), { recursive: true, force: true });

  return [
    {
      entry: ["src/index.ts", "src/ipc.ts"],
      // ESM only: Rolldown shares a require-helper preamble across a dual
      // ["esm","cjs"] build regardless of whether either target calls it, so
      // the CJS target's legitimate `createRequire` leaked into ESM as dead code.
      format: ["esm"],
      dts: true,
      clean: false,
      platform: "node",
      define: {
        __SDK_VERSION__: JSON.stringify(pkg.version),
      },
    },
    {
      // A sandboxed Electron preload script is CommonJS-only in many real
      // configurations, and never touches `createRequire` the way index.ts's
      // entries transitively do, so it gets the dual build those can't.
      entry: ["src/preload.ts"],
      format: ["esm", "cjs"],
      dts: true,
      clean: false,
      platform: "node",
    },
  ];
});
