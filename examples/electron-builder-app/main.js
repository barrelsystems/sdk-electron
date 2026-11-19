import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "@barrel-kit/sdk-electron";
import { registerIpcHandlers } from "@barrel-kit/sdk-electron/ipc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// init() owns the Squirrel-startup check itself (quitting before any window
// exists when needed) -- a host app must never also check
// electron-squirrel-startup, and must call init() before creating a window.
init({
  credential: process.env.BARREL_CREDENTIAL ?? "",
  baseUrl: process.env.BARREL_BASE_URL,
  updateFeedURL: process.env.BARREL_UPDATE_FEED_URL,
  debug: true,
  // Stops at the real "available" state rather than also auto-downloading:
  // a real download hands off to Squirrel's native apply machinery, which
  // needs a real code signature this unsigned test/demo build never has.
  autoDownload: !process.env.BARREL_UPDATE_FEED_URL,
});

registerIpcHandlers();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
