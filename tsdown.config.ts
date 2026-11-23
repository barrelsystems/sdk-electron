import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  fixedExtension: false,
  outputOptions: { chunkFileNames: "chunks/[name]-[hash].js" },
  platform: "node",
  define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
});
