# ADR 0002: One shared evaluation engine behind thin CLI/Action adapters

## Status

Accepted.

## Context

Axiom ships two entrypoints operators actually invoke: a local CLI and a GitHub Action. Both
need to compile the same config, evaluate the same input the same way, apply the same
redaction rules, and produce the same report shape. Implementing validation/evaluation logic
twice -- once per adapter -- would let the two drift: a schema edge case, a redaction rule, or
an exit-code mapping fixed in one adapter but not the other would silently produce different
decisions for the same config and input depending on which entrypoint ran it. That is
unacceptable for a tool whose entire purpose is being a trustworthy, deterministic decision
maker.

## Decision

All configuration parsing, path resolution, I/O orchestration, schema/invariant/policy
evaluation, retry handling, metrics aggregation, baseline comparison, redaction, and report
rendering lives in one package, [`packages/core`](../../packages/core), behind a small set of
top-level workflow entrypoints
([`runCheckWorkflow`](../../packages/core/src/engine/workflow.ts),
`runCompareWorkflow`). Every adapter calls these functions and does nothing else of
consequence:

- [`packages/cli`](../../packages/cli)'s commands (`init`/`check`/`compare`/`report`) parse
  `argv`, call the matching `@axiom/core` function, and print the resulting
  `status`/`exitCode` -- see `packages/cli/src/commands/*.ts`, each of which documents "the
  CLI adapter makes no decision of its own here."
- [`packages/action`](../../packages/action)'s `run()`
  ([`index.ts`](../../packages/action/src/index.ts)) parses Actions inputs, calls the exact
  same `runCheckWorkflow`/`runCompareWorkflow`, and translates the resulting report into
  `@actions/core` outputs/annotations/summary -- again, no validation or evaluation logic of
  its own.

Both effect boundaries (filesystem, process spawning) are injected as ports
([`packages/core/src/runtime/ports.ts`](../../packages/core/src/runtime/ports.ts)) rather
than imported directly, so the exact same engine code runs against a real filesystem/process
in production and an in-memory fake in unit tests, with no adapter-specific behavior to
diverge.

## Consequences

- **Positive:** a fix or new rule lands once, in `@axiom/core`, and both the CLI and the
  Action pick it up identically. This is directly testable, not just asserted:
  `packages/action/src/action-cli-parity.test.ts` spawns the real built CLI
  (`packages/cli/dist/index.js`) and the real committed Action bundle
  (`dist/action/index.cjs`) as separate OS processes against byte-identical fixtures and
  diffs their exit codes and full report output.
- **Positive:** `packages/core`'s own public surface
  ([`packages/core/src/index.ts`](../../packages/core/src/index.ts)) is the enforced package
  boundary -- adapters import only what is re-exported there, never a deep
  `@axiom/core/src/...` path, so the boundary between "shared engine" and "thin adapter" is
  structural, not just a comment.
- **Negative:** any behavior that is genuinely adapter-specific (Actions annotation/summary
  formatting, byte caps on annotation output, CLI help text) has to be deliberately kept out
  of `@axiom/core` and back in the adapter, which requires ongoing discipline during review --
  the temptation to "just add one more `if (isAction)`" inside the shared engine is exactly
  what this ADR exists to head off.
