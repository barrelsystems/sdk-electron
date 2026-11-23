const { contextBridge, ipcRenderer } = require("electron");

/** @type {Window["updates"]} */
const updates = {
  async subscribe(listener) {
    /** @param {Electron.IpcRendererEvent} _event @param {import("@barrel-kit/sdk-electron").Updates.Status} status */
    function receive(_event, status) {
      listener(status);
    }

    ipcRenderer.on("updates:status", receive);

    try {
      await ipcRenderer.invoke("updates:subscribe");
    } catch (error) {
      ipcRenderer.removeListener("updates:status", receive);
      throw error;
    }

    return () => ipcRenderer.removeListener("updates:status", receive);
  },
  apply: () => ipcRenderer.invoke("updates:apply"),
};

contextBridge.exposeInMainWorld("updates", updates);
