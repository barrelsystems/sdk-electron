// A sandboxed preload script can only `require()` `electron` itself --
// never a third-party package. `exposeBarrelBridge()` only works for a
// *bundled* preload (the Forge example, via Vite); this plain one can't.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("barrel", {
  getStatus: () => ipcRenderer.invoke("barrel:getStatus"),
  applyUpdate: () => ipcRenderer.invoke("barrel:applyUpdate"),
});
