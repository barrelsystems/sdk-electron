import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Updates } from '@barrel-kit/sdk-electron';

contextBridge.exposeInMainWorld('updates', {
  async subscribe(listener: (status: Updates.Status) => void) {
    const receive = (_event: IpcRendererEvent, status: Updates.Status) =>
      listener(status);
    ipcRenderer.on('updates:status', receive);
    try {
      await ipcRenderer.invoke('updates:subscribe');
    } catch (error) {
      ipcRenderer.removeListener('updates:status', receive);
      throw error;
    }

    return () => ipcRenderer.removeListener('updates:status', receive);
  },
  apply: () => ipcRenderer.invoke('updates:apply'),
});
