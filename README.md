# @barrel-kit/sdk-electron

Barrel's release-intelligence SDK for Electron. It wraps whichever updater
you're already using — `electron-updater` if it's in your dependencies,
Electron's built-in `autoUpdater` otherwise — and reports what actually
happened on a check, download, or install, instead of leaving you to
reconstruct it from support tickets.

`electron-updater` supports macOS, Windows, and Linux. Electron's built-in
`autoUpdater` supports macOS and Windows; Linux apps need `electron-updater`.

Your release feed and binaries stay on your own infrastructure. Barrel
doesn't host or verify either one. If our backend is down, signs something
wrong, or is just unreachable, updates keep working exactly as they would
without us — the SDK stops reporting until it can reach us again, nothing
more.

## Install

```sh
npm install @barrel-kit/sdk-electron
```

## Use it

In your main process, before any `BrowserWindow` is created:

```ts
import { init } from "@barrel-kit/sdk-electron";
import { registerIpcHandlers } from "@barrel-kit/sdk-electron/ipc";

init({
  credential: process.env.BARREL_CREDENTIAL!,
  updateFeedURL: "https://updates.example.com/latest.json", // omit to use your packaging tool's own build-time config
});
registerIpcHandlers(); // wires Barrel's state up for the renderer over IPC
```

If your preload script is bundled (Vite, webpack — Electron Forge's default
templates are), expose that state to the renderer:

```ts
// preload.ts
import { exposeBarrelBridge } from "@barrel-kit/sdk-electron/preload";
exposeBarrelBridge(); // window.barrel.getStatus() / window.barrel.applyUpdate()
```

An unbundled, plain `.cjs` preload script (electron-builder's default) can't
`require()` a third-party package — that's an Electron sandboxing
restriction, not something we can route around — so write the same
four-line `contextBridge`/`ipcRenderer` bridge by hand instead. See
`examples/electron-builder-app/preload.cjs` for the shape.

Anywhere else, read state synchronously or subscribe to transitions:

```ts
import {
  getPolicy,
  getAdapterState,
  getLastUpdateError,
  onStateChange,
  downloadUpdate,
  applyUpdate,
} from "@barrel-kit/sdk-electron";

const policy = getPolicy(); // Policy | undefined
const state = getAdapterState(); // AdapterState | undefined
const lastError = getLastUpdateError(); // UpdateFailure | undefined

onStateChange((state) => {
  /* re-render on every local transition */
});

downloadUpdate(); // manual trigger, needed only with autoDownload: false
applyUpdate(); // host-triggered install, ahead of the natural quit-time default
```

`init()` only throws synchronously for a blank `credential`. After that
it's silent and fails open: a network blip or a bad signature from Barrel
never blocks an update.

## What it does

A few things happen automatically once you call `init()`:

- Checks in on launch, then every 30 minutes, jittered per install so your
  fleet doesn't all hit Barrel's ingestion at once.
- Reports the channel key in `InitConfig.channel` verbatim on every check-in
  (default: `"stable"`), without changing the updater's feed. Keys are
  case-sensitive; use the configured key rather than its display name.
- Verifies the signature on every Policy response with Node's own
  `node:crypto` — no third-party crypto dependency.
- Keeps one random installation ID on disk. Not your users' hardware
  identity, not a fingerprint.
- Clamps whatever custom attributes you attach, so a bug in your own code
  can't blow past what Barrel's ingestion will accept.
- Detects and wraps whichever updater you already have — `electron-updater`
  if it's in your dependencies, Electron's built-in `autoUpdater` if not —
  including its feed URL, so you never call either library directly.
  `AdapterState` reports the real lifecycle
  (`checking`/`available`/`downloading`/`downloaded`/`update-cancelled`/`failed`),
  and failures get classified into one stable `failureMode` you can read
  with `getLastUpdateError()` or subscribe to with `onStateChange()`.
- Passes along whatever release notes the updater's feed provides, when it
  provides any.
- Buffers facts locally if a check-in fails, and flushes them on the next
  successful one, so a network blip during an update doesn't just vanish.
- Re-checks Policy right before every download and install, not just on
  the 30-minute cadence, so a Hold placed since the last check-in still
  lands in time.
- Downloads automatically once it finds something, by default. Set
  `autoDownload: false` and call `downloadUpdate()` yourself for more
  control over timing.
- Handles Windows' Squirrel quit-on-install lifecycle for you. Don't also
  check `electron-squirrel-startup` yourself, and call `init()` before
  creating any window.
- Tallies its own adapter defects locally without sending reports or
  crashing your app.

## Picking an updater

If `electron-updater` is in your own `dependencies`, that's what gets
wrapped. Otherwise it falls back to Electron's built-in `autoUpdater`,
which needs nothing extra installed. You don't configure this; it's
whichever one you already brought in.

## What's still yours

Targeting and rollout percentages are configured on Barrel's dashboard.
Your manifest and binaries are yours to build and host; `updateFeedURL`
just points at them. Barrel never hosts or validates either.

## Dependencies

No required runtime dependencies of our own. `electron-updater` is an
optional peer, wrapped only if you've already chosen it. Everything else —
`node:crypto`, `node:fs`, `node:os` — is a Node built-in. This ships inside
your app, so every dependency we add is one you'd carry, not us.

Source ownership is described in [Architecture](docs/architecture.md).
