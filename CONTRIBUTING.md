# Contributing

Thanks for your interest in improving `@barrel-kit/sdk-electron`.

## Reporting a bug or requesting a feature

Open a [GitHub issue](https://github.com/barrelsystems/sdk-electron/issues).
For a bug, include the SDK version, Electron version, OS/architecture, and a
minimal reproduction. For a feature request, describe the use case before the
proposed API.

## Local development setup

This repo uses [pnpm](https://pnpm.io). From the repo root:

```sh
pnpm install
```

Build the SDK:

```sh
pnpm build
```

Or build in watch mode while developing:

```sh
pnpm dev
```

The example apps under `examples/` have their own dependencies:

```sh
pnpm install:examples
```

## Running tests and lint before opening a PR

Run these before opening a PR; CI runs the same checks:

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm size
```

`pnpm test-service` starts the conformance test service used by the shared
cross-SDK conformance harness, if you're working on protocol-level behavior.

## Pull request process

Open your PR against `master`, not `main`. Keep PRs focused on a single
change, and explain the "why" in the description, not just the "what". Note
any size-budget impact (`pnpm size`) if your change touches `dist/index.js`
or its chunks.

## Code of conduct

Participation in this project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
