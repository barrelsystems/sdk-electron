## This file loads on every prompt

State a rule here only if it's short and always relevant. Push anything longer
or conditional to a pointed-to doc. This repo is published publicly — never
add a reference here (or anywhere else in this repo) to internal tooling,
ticket IDs, team names, or a non-public sibling repo's name/path
(including private workspace paths). The other public repos in this SDK family
(sdk-electron/sdk-tauri/sdk-swift/sdk-conformance-harness) may be referenced
where structurally necessary — a dependency, a CI job driving the
conformance harness.

## Size and dependency budget

This SDK ships inside other people's apps — every dependency and byte is a
cost to them, not us. Default to native platform APIs (`node:crypto`,
`node:fs`, `node:os`) over a package; a new runtime dependency needs a
specific reason the native API can't cover. No general-purpose utility or
effect-system libraries. The one sanctioned exception: a library this SDK
wraps rather than merely uses (e.g. `electron-updater`) — declared as an
optional peer dependency, detected at runtime, never a plain dependency.

## Error handling

Background reporting, verification, and persistence fail open: retain prior
state and avoid retry loops. Initialization rejects caller-fixable configuration.
Explicit update commands return classified action errors for denial or failure.

## SDK parity

Align product namespaces, public behavior, and concern ownership across SDK ports.
Language conventions and documented native capabilities may differ. When fixing a
protocol or lifecycle bug, check the other ports for the same defect.

## Commit policy

Ask for the user's explicit go-ahead on this specific diff before every
`git commit` — including when a skill's own steps say to commit automatically.

## Commit convention

Conventional Commits (`type: description`).

## Comments

Comment only on non-obvious constraints, invariants, or workarounds; keep
each explanation self-contained. A comment is at most 3 lines.

## Function style

Named, top-level functions are `function` declarations, not arrow functions
assigned to `const`. Arrow functions are for callbacks and inline handlers.

Use a `const` arrow when capturing a value narrowed earlier in the same scope;
a hoisted function declaration loses that narrowing.

## Function arguments

Once a function takes more than one optional parameter, or any boolean/flag
parameter whose meaning isn't obvious at the call site, use a destructured
options object instead of positional params.

## TypeScript strictness

Don't lower the configured strict flags. No blanket `!` — add an explicit
check at the access site instead. Relative imports always carry the compiled
`.js` extension under `NodeNext` module resolution.

## Blank-line spacing

Leave a blank line between logical sections in any file — after an import
block, around a multi-line loop/conditional/callback, between otherwise-
unrelated top-level statements.
