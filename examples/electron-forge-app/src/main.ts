import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { init } from '@barrel-kit/sdk-electron';
import { registerIpcHandlers } from '@barrel-kit/sdk-electron/ipc';

// init() owns the Squirrel-startup check itself (quitting before any window
// exists when needed) -- a host app must never also check
// electron-squirrel-startup, and must call init() before creating a window.
init({
  credential: process.env.BARREL_CREDENTIAL ?? '',
  baseUrl: process.env.BARREL_BASE_URL,
  updateFeedURL: process.env.BARREL_UPDATE_FEED_URL,
  debug: true,
  // Stops at the real "available" state rather than also auto-downloading:
  // a real download hands off to Squirrel's native apply machinery, which
  // needs a real code signature this unsigned test/demo build never has.
  autoDownload: !process.env.BARREL_UPDATE_FEED_URL,
});

registerIpcHandlers();

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
