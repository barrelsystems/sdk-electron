import { defineConfig } from 'vite';

// Keep SDK subpaths external too: inlining its ESM into a CJS main bundle
// rewrites import.meta.url, breaking the SDK's native module loader.
export default defineConfig({
  build: {
    rolldownOptions: {
      external: [
        /^@barrel-kit\/sdk-electron(?:\/|$)/,
        'electron-squirrel-startup',
        'electron-updater',
      ],
    },
  },
});
