# Electron examples

```sh
pnpm install --frozen-lockfile
pnpm install:examples
pnpm typecheck
pnpm check:examples
```

Set `BARREL_CREDENTIAL` and, for local development, `BARREL_BASE_URL` and
`BARREL_UPDATE_FEED_URL`. Run `pnpm start` inside either example directory.

## Native utility and visible framework transport

```text
Main: Updates.subscribe → webContents.send → preload listener → status display
Restart click → ipcRenderer.invoke → main handler → Updates.apply()
```

[Builder main](electron-builder-app/main.js) and [Forge main](electron-forge-app/src/main.ts)
demonstrate `Updates.subscribe()` and `Updates.apply()`. The SDK downloads automatically. The view shows a status message, progress,
and “Restart to update” when ready.

The [Builder preload](electron-builder-app/preload.cjs) and
[Forge preload](electron-forge-app/src/preload.ts) use Electron's primitives directly.
Channel names, frame validation and transport belong to this application example,
not the SDK. The [Builder view](electron-builder-app/renderer.js) and
[Forge view](electron-forge-app/src/renderer.ts) contain no native update logic.

Menus can call the same utility directly in main:

```ts
Menu.buildFromTemplate([
  {
    label: "Restart to update",
    click: () => {
      void Updates.apply().catch(console.error);
    },
  },
]);
```

Keep a native status subscription to enable menu actions only when appropriate.
The utility validates state and eligibility for every action regardless of UI.
`pnpm check:examples` installs the current SDK tarball into temporary copies of
both examples, typechecks their source, and builds unpacked applications using
their respective packagers. It leaves the working examples untouched and removes
the temporary files afterward. CI runs the check on macOS, Windows, and Linux.
It does not launch applications or verify
installation/relaunch behavior.
