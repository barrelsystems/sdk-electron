/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
import type { Updates } from '@barrel-kit/sdk-electron';

declare global {
  interface Window {
    updates: {
      subscribe(
        listener: (status: Updates.Status) => void,
      ): Promise<() => void>;
      apply(): Promise<void>;
    };
  }
}
