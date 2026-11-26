# Third-party licenses

This package has zero runtime `dependencies` — nothing is bundled into
consumer apps beyond this package's own code. It declares `electron`,
`electron-squirrel-startup`, and `electron-updater` as `peerDependencies`:
each consuming app supplies its own copy of these, under whichever license
that app's own `node_modules` resolves, so this package neither bundles nor
redistributes them.

Development-only tooling (build, lint, test) isn't distributed to consumers
and isn't listed here.

If a runtime dependency is ever added, regenerate this file with
`pnpm licenses list --prod`.
