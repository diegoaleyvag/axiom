# ADR 0005: Deterministic, committed, dependency-free Action bundle

## Status

Accepted.

## Context

A GitHub Action declared with `runs: { using: 'node24', main: '<file>' }` runs `<file>`
directly with the Node.js the Actions runner provides -- there is no install step, no
`node_modules` resolution performed by the runner itself, and (for a repository-relative
Action like this one, referenced as `uses: ./`) no package-manager step at all. If
`action.yml`'s `main` pointed at `packages/action/dist/main.js` (the plain `tsc --build`
output), every one of its `import`ed dependencies -- `@actions/core`, `@axiom/core`'s entire
compiled tree, `ajv`, `re2js`, `yaml`, ... -- would need to already be resolvable from
`node_modules` at the point the runner invokes it, which is fragile (depends on install state
and workspace layout at the exact commit checked out) and, for anyone consuming the Action
from outside this repository's own workspace, simply would not work at all.

## Decision

The Action's real entrypoint is a single, dependency-free, deterministically-bundled
CommonJS file, committed at [`dist/action/index.cjs`](../../dist/action/index.cjs) and
referenced directly by [`action.yml`](../../action.yml). It is produced by
[`scripts/build-action-bundle.mjs`](../../scripts/build-action-bundle.mjs), which bundles
[`packages/action/src/main.ts`](../../packages/action/src/main.ts) (and, transitively,
`@axiom/core` and `@actions/core`) with esbuild, explicitly configured for reproducibility:

- `bundle: true` -- every dependency is inlined; the runner needs nothing beyond the one file.
- `format: 'cjs'` -- unambiguous module kind regardless of any nearby `package.json`'s
  `"type"`; CommonJS also has no top-level `await`, which is why
  [`main.ts`](../../packages/action/src/main.ts) wraps its entrypoint in an async IIFE rather
  than using one.
- `sourcemap: false`, `minify: false`, `legalComments: 'none'` -- the output is meant to be
  byte-diffable and auditable, not optimized for size; there is nothing performance-sensitive
  about an Action's startup bundle size at this scale.
- No timestamps, no machine-specific absolute paths baked into the output (`absWorkingDir` is
  fixed to the repository root) -- the same source tree always produces byte-identical output
  on any machine.

Freshness is a **checked gate**, not a convention:
[`scripts/verify-action-bundle.mjs`](../../scripts/verify-action-bundle.mjs) (wired to
`pnpm action:bundle:check`, and CI's "Action bundle freshness" step) rebuilds the exact same
entrypoint into a temporary directory with the identical esbuild invocation and byte-diffs it
against the committed file. A source change that was not followed by rebuilding and
committing the bundle fails CI, rather than shipping a stale bundle silently.

`run()` ([`packages/action/src/index.ts`](../../packages/action/src/index.ts)) stays a plain,
unit-testable async function returning the real `0`/`1`/`2`/`3` axiom exit code; only
`main.ts` -- the file actually bundled and referenced by `action.yml` -- translates that into
the Actions runner's binary success/failure convention (`core.setFailed` for anything
non-zero), since the runner itself has no concept of exit codes `2`/`3` distinct from a
generic failure. This split is what keeps `index.ts` testable with plain Vitest
(`packages/action/src/index.test.ts`) without needing to spawn a process, while still
allowing `packages/action/src/action-cli-parity.test.ts` to exercise the _actual_ bundled
artifact as a real subprocess against the real CLI.

## Consequences

- **Positive:** the Action works when referenced with `uses: ./` (or, eventually, a pinned
  tag) with no install step of its own, and its startup behavior is fully reproducible from
  source.
- **Positive:** bundle staleness is caught in CI immediately, not discovered later as
  "the Action behaves differently than the source suggests."
- **Negative:** every core/action source change that should affect the Action's behavior
  requires an explicit `pnpm build:action-bundle` + commit step; forgetting it does not break
  the build locally (only `pnpm action:bundle:check`/CI catches it), which is a discipline
  cost this ADR accepts in exchange for a fully offline, install-free Action.
- **Negative:** the committed bundle is a large, mostly-unreadable-by-humans single file
  (esbuild's inlined output); it is intentionally not meant to be reviewed line-by-line --
  the source files under `packages/action/src` and `packages/core/src` are the reviewable
  artifact, and the bundle's _correctness_ is established by the byte-diff gate plus
  `action-cli-parity.test.ts`'s behavioral equivalence check, not by reading the bundle
  itself.
