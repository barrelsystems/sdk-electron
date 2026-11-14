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
import { init, getPolicy } from "@barrel-kit/sdk-electron";

init({ credential: process.env.BARREL_CREDENTIAL! });

// later, anywhere:
const policy = getPolicy(); // Policy | undefined
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

## What it doesn't do yet

This is the thinnest tracer bullet, not the finished SDK:

- `AdapterState` only ever reports `idle`. Full lifecycle ownership of
  `electron-updater`/`autoUpdater`, the canonical error taxonomy, and
  `applyUpdate()`/auto-download control are still ahead.
- No offline fact buffer, and no fresh pre-action check immediately before
  a download or install. Both are coming, tracked as their own work.

Track progress in this repo's own issues.

## Size budget

Zero runtime dependencies. Native platform APIs only — `node:crypto`,
`node:fs`, `node:os`. This ships inside your app; every dependency we'd add
is a cost you'd carry, not us.
