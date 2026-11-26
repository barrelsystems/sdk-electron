import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    // Vitest's 5000ms default has no headroom for Windows CI runners' slower
    // module-resolution/fs overhead under vi.resetModules() + dynamic import.
    testTimeout: 15000,
  },
  define: {
    __SDK_VERSION__: JSON.stringify("0.0.0-test"),
  },
});
