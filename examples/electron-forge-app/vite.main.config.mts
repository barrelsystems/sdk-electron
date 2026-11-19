import { defineConfig } from 'vite';

// Electron's main process already has full Node module resolution at
// runtime -- externalizing real npm dependencies (rather than letting Vite
// inline them) avoids bundler-specific breakage: Rolldown's ESM output
// polyfills any `require` reference via `createRequire(import.meta.url)`
// unconditionally (even inside a feature-detection `typeof` check), which
// then breaks when Vite further inlines that already-built code into its
// own CJS output.
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        '@barrel-kit/sdk-electron',
        'electron-squirrel-startup',
        'electron-updater',
      ],
    },
  },
});
