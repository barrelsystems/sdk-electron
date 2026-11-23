import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { init, Updates } from '@barrel-kit/sdk-electron';

// init() owns the Squirrel-startup check itself (quitting before any window
// exists when needed) -- a host app must never also check
// electron-squirrel-startup, and must call init() before creating a window.
init({
  credential: process.env.BARREL_CREDENTIAL ?? '',
  baseUrl: process.env.BARREL_BASE_URL,
  debug: true,
  updates: {
    updateFeedURL: process.env.BARREL_UPDATE_FEED_URL,
  },
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const contents = mainWindow.webContents;
  let subscription: Updates.Subscription | undefined;

  function stop() {
    subscription?.remove();
    subscription = undefined;
  }

  contents.ipc.handle('updates:subscribe', (event) => {
    if (event.senderFrame !== contents.mainFrame)
      throw new Error('Invalid frame');

    stop();
    subscription = Updates.subscribe((status) =>
      contents.send('updates:status', status),
    );
  });
  contents.ipc.handle('updates:apply', (event) => {
    if (event.senderFrame !== contents.mainFrame)
      throw new Error('Invalid frame');

    return Updates.apply();
  });
  contents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) stop();
  });
  contents.once('destroyed', stop);

  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

app.whenReady().then(() => {
  createWindow();

  // Reopen a window when the macOS dock activates an otherwise windowless app.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// macOS keeps the process running after its last window closes.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
