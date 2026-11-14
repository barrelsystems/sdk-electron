# @barrel-kit/sdk-electron

Barrel's release-intelligence SDK for Electron apps.

Implements Barrel's check-in/Policy wire protocol.

## Status

Thinnest tracer bullet: `init()` (including the Electron-main-process check), cadence, bounded `attributes`, installation-ID persistence (serialized against concurrent calls, with a synchronous exit-time write), Policy fetch + Ed25519 verification, `getPolicy()`, and an opt-in debug-logging mode. `AdapterState` is reported as `idle` only — full lifecycle and the canonical error taxonomy are a separate follow-on. `bufferedFacts` and the pre-action check are tracked as their own separate tickets, not yet implemented here. The host control surface (`applyUpdate()`, auto-download/apply, `electron-squirrel-startup`) is a separate follow-on too.

## Usage

```ts
import { init, getPolicy } from "@barrel-kit/sdk-electron";

init({ credential: process.env.BARREL_CREDENTIAL! });

// later, anywhere:
const policy = getPolicy(); // Policy | undefined
```
