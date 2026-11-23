# Barrel for Electron

Release reporting and update eligibility for Electron applications. Requires Electron 30 or later. The optional
`electron-updater` supports macOS, Windows and Linux; the built-in updater supports
macOS and Windows.

## Install

There is no tagged release yet. Install from source:

```sh
npm install github:barrelsystems/sdk-electron
```

## Quick start

```ts
import { init, Updates } from "@barrel-kit/sdk-electron";

init({ credential: "your-project-sdk-credential", updates: { autoDownload: false } });

const subscription = Updates.subscribe((status) => {
  /* render status */
});

// When status.state.type is "available":
await Updates.download();

// After verified download:
await Updates.apply();

subscription.remove();
```

## Configuration

| Setting      | Default         | Purpose                                      |
| ------------ | --------------- | -------------------------------------------- |
| `credential` | Required        | Project SDK credential.                      |
| `baseUrl`    | Barrel endpoint | Reporting endpoint override for development. |
| `debug`      | `false`         | Diagnostic logging.                          |
| `updates`    | Defaults below  | Update-specific configuration.               |

Fields inside `updates`:

| Setting             | Default               | Purpose                                                         |
| ------------------- | --------------------- | --------------------------------------------------------------- |
| `checkInIntervalMs` | 30 minutes            | Nominal cadence in milliseconds, clamped to 15 minutes–2 hours. |
| `channel`           | `"stable"`            | Observed release track.                                         |
| `attributes`        | `{}`                  | String attributes included in reporting.                        |
| `autoDownload`      | `true`                | Download available updates automatically.                       |
| `updateFeedURL`     | Updater configuration | Override the release feed.                                      |
| `holdCacheMaxAge`   | 24 hours              | Cached Hold lifetime in milliseconds; maximum seven days.       |

## Update controls

Status contains `state`, `eligibility`, and `lastError`. Subscriptions receive a
complete initial snapshot and subsequent snapshots; intermediate transitions may
coalesce. Keep the returned subscription alive and remove it when no longer used.

Manual download completes after verified download. Manual apply completes at
installer handoff if the process survives long enough to return; it cannot confirm
a successful relaunch. Commands report classified errors for an unready SDK,
invalid state, a concurrent action, Hold, cancellation, or native failure.
Background reporting remains fail open.

Initialize in the main process before creating windows. Keep the updater's normal
feed configuration; avoid a second update loop or separate Squirrel startup handler.
Catch `Updates.ActionError` and inspect `code` and optional `failure` for manual actions.
The built-in updater cannot separate checking from downloading or expose progress;
use `electron-updater` when those controls are needed.

The SDK is a main-process utility. Native menus and other main-process code can
call `Updates.subscribe`, `Updates.download` and `Updates.apply` directly, without
a window or renderer. It has no renderer runtime or IPC exports.

The [examples](examples/README.md) show application-owned Electron IPC: main
subscribes to the utility and forwards snapshots; preload exposes specific
operations; the renderer displays status and sends a restart request. Main's IPC
handler calls `Updates.apply()`. Automatic download stays in the native utility.

## Behavior

- Reporting, verification failures, and unavailable storage fail open. A previously
  verified Hold remains effective within its configured cache lifetime.
- Downloads run automatically by default. A fresh verified Hold can defer a
  download or installation; it never prevents an ordinary application quit.
- Your application owns its release feed and artifacts. The native updater
  verifies artifacts and installs them; Barrel verifies eligibility decisions.
- Reports version, operating system, architecture, update state/errors, channel,
  configured attributes, and a locally generated installation identifier.
- `channel` is an observed, case-sensitive release track; it does not select a feed.
  Attributes are limited to 20 keys and 256 UTF-8 bytes per value.
- Debug logging is disabled by default. Reporting is best effort.

## Examples and support

- [Run the packaging examples](examples/README.md)
- [Report a problem](https://github.com/barrelsystems/sdk-electron/issues)
