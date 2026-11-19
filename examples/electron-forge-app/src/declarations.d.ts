/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import type { BarrelBridge } from '@barrel-kit/sdk-electron/preload';

declare global {
  interface Window {
    barrel: BarrelBridge;
  }
}
