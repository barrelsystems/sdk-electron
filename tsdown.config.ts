import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig([
  {
    entry: ["src/index.ts", "src/ipc.ts"],
    // ESM only: Rolldown shares a require-helper preamble across a dual
    // ["esm","cjs"] build regardless of whether either target calls it, so
    // the CJS target's legitimate `createRequire` leaked into ESM as dead code.
    format: ["esm"],
    dts: true,
    clean: true,
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
]);
