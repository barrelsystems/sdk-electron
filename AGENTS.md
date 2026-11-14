## This file loads on every prompt

State a rule here only if it's short and always relevant. Push anything longer
or conditional to a pointed-to doc. This repo is published publicly — never
add a reference here (or anywhere else in this repo) to internal tooling,
ticket IDs, team names, or sibling repo names/paths.

## Size and dependency budget

This SDK ships inside other people's apps — every dependency and byte is a
cost to them, not us. Default to native platform APIs (`node:crypto`,
`node:fs`, `node:os`) over a package; a new runtime dependency needs a
specific reason the native API can't cover. No general-purpose utility or
effect-system libraries.

## Error handling

Every I/O path (installation-ID persistence, check-in requests, Policy
signature verification) fails open: keep the prior state, never throw, never
retry in a loop. A thrown error is reserved for synchronous, caller-fixable
misconfiguration (e.g. a blank credential passed to `init()`).

## Tooling

tsdown (build), vitest (test), oxlint/oxfmt (lint/format).

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
