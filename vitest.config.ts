import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["./tests/setup.ts"] },
  define: {
    __SDK_VERSION__: JSON.stringify("0.0.0-test"),
  },
});
