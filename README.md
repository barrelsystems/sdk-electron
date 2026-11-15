# @barrel-kit/sdk-electron

One call, and your app starts reporting what's actually happening to its
updates — not what your dashboard hopes is happening.

This is Barrel's release-intelligence SDK for Electron. It doesn't replace
your updater. It doesn't touch your binaries. Your releases stay on your own
infrastructure; this just watches, reports, and gets out of the way the
moment anything goes wrong.

## Install

```sh
npm install @barrel-kit/sdk-electron
```

## Use it

```ts
import { init, getPolicy, getLastUpdateError } from "@barrel-kit/sdk-electron";

init({ credential: process.env.BARREL_CREDENTIAL! });

// later, anywhere:
const policy = getPolicy(); // Policy | undefined
const lastError = getLastUpdateError(); // UpdateFailure | undefined
```

That's the whole required surface. `init()` is silent until you call it,
throws synchronously only for invalid config, and never throws again after
that. A network blip, a bad signature, Barrel being unreachable entirely —
every one of those fails open. Your users' updates are never the thing that
breaks because Barrel had a bad day.

## What it actually does

- Checks in on launch, then every 30 minutes, jittered per installation so
  your whole fleet doesn't hit Barrel's ingestion at the same moment.
- Verifies every Policy response's Ed25519 signature with Node's own
  `node:crypto` — no third-party crypto package, nothing extra to audit.
- Persists one random installation ID locally. Never your users' hardware
  identity, never fingerprinted.
- Bounds whatever custom attributes you attach, so a bug in your own code
  can't balloon a check-in past what Barrel will accept.
- Ships an opt-in debug mode (`init({ debug: true })`) that logs exactly
  what the SDK is doing via `console.debug` — off by default, never noisy
  unless you ask for it.
- Fully owns whichever updater you use — `electron-updater` if it's in your
  own dependencies, Electron's built-in `autoUpdater` otherwise, detected
  automatically. Either way, `AdapterState` reports the real lifecycle
  (`checking`/`available`/`downloading`/`downloaded`/`update-cancelled`/`failed`),
  and a failure classifies into one stable, cross-platform `failureMode` —
  check it with `getLastUpdateError()`.
- Tallies (never captures) an unexpected bug in its own adapter code, so one
  can never crash your app. That tally isn't sent anywhere yet — only an
  anonymous, opt-out count would ever be, matching the one real precedent
  for this (even Sentry's own SDKs don't self-report full exceptions) — and
  it's blocked on Barrel provisioning a project to send it to.

## How it picks an updater

If `electron-updater` is in your own `dependencies`, it's wrapped. If not,
Electron's built-in `autoUpdater` is used instead — free, no extra install.
Nothing to configure: the choice is just whichever one you already have.

## What it doesn't do yet

This is still short of the finished SDK:

- No offline fact buffer, and no fresh pre-action check immediately before
  a download or install.
- No `applyUpdate()`/auto-download control yet, and `sdk-electron` doesn't
  take over `electron-squirrel-startup` for you yet either.

Track progress in this repo's own issues.

## Size budget

Zero required runtime dependencies — `electron-updater` is an optional peer,
wrapped only if you've already chosen it yourself. Everything else is a
native platform API (`node:crypto`, `node:fs`, `node:os`). This ships inside
your app; every dependency we'd add is a cost you'd carry, not us.
