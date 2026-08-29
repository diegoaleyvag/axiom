# HANDOFF

Axiom validates structured AI outputs as software contracts, offline and provider-neutral,
via one shared evaluation engine ([`packages/core`](packages/core)) behind a local CLI
([`packages/cli`](packages/cli)) and a bundled GitHub Action
([`packages/action`](packages/action)). This document is for whoever reviews or continues
this work next: how to verify it, how it is put together, and what is deliberately not done
yet.

## How to review this repository

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck          # tsc --build; also emits dist/, which the E2E tests below need
pnpm test               # unit + property-based + real-OS-process + subprocess E2E tests
pnpm build              # tsc --build again (idempotent given a clean tree)
pnpm action:bundle:check       # fails if dist/action/index.cjs is stale relative to source
pnpm examples:evidence:check   # fails if examples/greenhouse-inspection/evidence is stale
```

All six commands are wired into [`.github/workflows/ci.yml`](.github/workflows/ci.yml), in
this order, on every push to `main` and every pull request. There is no secret and no
network access anywhere in this pipeline.

To see the engine actually decide something:

```bash
node packages/cli/dist/index.js check --config examples/greenhouse-inspection/axiom.config.yaml
node packages/cli/dist/index.js compare --config examples/greenhouse-inspection/axiom.config.yaml
```

Both are _expected_ to exit `1` -- see [`docs/failure-examples.md`](docs/failure-examples.md)
for exactly why, finding by finding. The same fixtures run through the bundled Action in
[`.github/workflows/axiom-example.yml`](.github/workflows/axiom-example.yml).

### Test suite map

| Concern                                                                                                                        | Where                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Unit tests (one module at a time, fake fs/process)                                                                             | `packages/core/src/**/*.test.ts`                                                         |
| Property-based tests (fast-check, `numRuns: 200-500`)                                                                          | Files with a `describe(...: property (...))` block -- see below                          |
| Config phase-order guarantee (invalid config touches nothing else)                                                             | `packages/core/src/config/phase-order.test.ts`                                           |
| Real-path/symlink containment (real filesystem, real symlinks)                                                                 | `packages/core/src/config/paths.test.ts`, `packages/core/src/engine/run-config.test.ts`  |
| Real OS process safety (injection, timeout, output overflow, process-tree kill, stdin, env allowlist)                          | `packages/core/src/runtime/node-process.test.ts` -- spawns real child processes, no fake |
| CLI in-process integration (all 4 commands, all 4 exit codes)                                                                  | `packages/cli/src/main.test.ts`                                                          |
| **CLI true subprocess E2E** (spawns the actual built `packages/cli/dist/index.js`)                                             | `packages/cli/src/cli.subprocess.test.ts`                                                |
| Action in-process integration (all 4 exit codes, annotations, summary, secret safety)                                          | `packages/action/src/index.test.ts`                                                      |
| **Action <-> CLI parity** (spawns the actual built CLI _and_ the committed `dist/action/index.cjs` as separate real processes) | `packages/action/src/action-cli-parity.test.ts`                                          |
| Acceptance corpus (9 scenarios, schema+invariant+policy+retry+baseline) + committed-evidence byte-equality                     | `examples/greenhouse-inspection/greenhouse.test.ts`                                      |

Property-based test files (fast-check): `packages/core/src/json/decode.test.ts`,
`packages/core/src/json/safe-object.test.ts`, `packages/core/src/redaction/redact.test.ts`,
`packages/core/src/engine/redact-report.test.ts`,
`packages/core/src/invariant/pointer.test.ts`, `packages/core/src/engine/decimal.test.ts`,
`packages/core/src/engine/compare.test.ts`, `packages/core/src/engine/evaluate-attempt.test.ts`,
`packages/core/src/engine/metrics.test.ts`, `packages/core/src/engine/run-case.test.ts`.

## Architecture, at a glance

```
CLIAdapter / GitHubActionAdapter
        |
        v
SharedApplicationEngine (packages/core)
   config -> ConfigCompiler (decode -> validate -> compile; no I/O until compiled)
   input  -> ArtifactSource | CommandSource ("explicit consent" gate)
   eval   -> json -> schema -> invariant -> policy (short-circuit per attempt)
   compare-> exact-fraction baseline threshold evaluation
   report -> value-free model -> defensive redaction -> JSON/Markdown renderers
```

See [`docs/adr/0002-shared-engine.md`](docs/adr/0002-shared-engine.md) for why the adapters
are intentionally thin, and [`packages/core/src/index.ts`](packages/core/src/index.ts) for
the enforced public-surface boundary adapters must stay within.

Reference documents:

- [`README.md`](README.md) -- quickstarts (CLI and Action).
- [`docs/configuration.md`](docs/configuration.md) -- every `axiom.config.yaml` field.
- [`docs/threat-model.md`](docs/threat-model.md) -- trust boundaries and controls.
- [`docs/taxonomy-and-exit-codes.md`](docs/taxonomy-and-exit-codes.md) -- exit codes, finding
  categories, malformed-candidate-vs-malformed-envelope.
- [`docs/report-format.md`](docs/report-format.md) -- the `axiom-report.v1` shape.
- [`docs/failure-examples.md`](docs/failure-examples.md) -- the 9 acceptance scenarios,
  finding by finding.
- [`docs/adr/`](docs/adr) -- provider neutrality, shared engine, safe declarative rules,
  exact baseline comparison, Action bundling.

## Cross-review findings resolved in this pass

All five findings from the prior cross-review were resolved and are covered by new/updated
tests (see the test suite map above for exact file locations):

1. **Real-path/symlink containment** was previously only enforced for report _write_
   targets. It is now also enforced, up front, for every schema/artifact path before a run
   reads any of them (`runAllChecks`, `packages/core/src/engine/run-config.ts`), and for the
   configured baseline report before `axiom compare` reads it (`workflow.ts`).
2. **Raw candidate object keys** matched by a `forbidden.patterns[].target: "keys"` rule are
   now length-bounded (`boundCandidateSegment`,
   `packages/core/src/engine/safe-pointer.ts`) before entering a report pointer, the same way
   an Ajv `instancePath` segment already was. Markdown rendering
   (`packages/core/src/engine/render/markdown.ts`) now additionally escapes backslashes,
   backticks, and angle brackets, strips control characters, collapses newlines, and caps
   cell length.
3. **Defensive `ruleId` redaction** now uses an id-shaped placeholder (`redacted`, whole-field
   replacement) instead of splicing the bracketed `[redacted]` value placeholder into a field
   the report schema constrains to `^[A-Za-z][A-Za-z0-9_-]{0,63}$` -- see
   `packages/core/src/redaction/redact.ts`'s `redactId`.
4. The four property-test files a prior pass had left unformatted are now
   `prettier`-formatted, and are exercised by every subsequent full `pnpm test` run in this
   pass.
5. **`retry.exhausted`** is now scoped to cases actually eligible for more than one attempt
   (see `docs/taxonomy-and-exit-codes.md`'s note), instead of firing for a single-attempt
   case merely because its check's configured `retries.maxAttempts` was greater than 1.

Two additional defects surfaced by new coverage in this pass (see `git log`/diff for the
exact commits, or search this repository for the corresponding test names):

- The Action's `run()` did not set the `exit-code` output on its error path (config/tooling
  failures), even though `action.yml` documents that output as covering all four exit codes.
  Fixed in `packages/action/src/index.ts`; regression-covered in `index.test.ts`.
- `comparison.baselineReportPath` stored the _resolved absolute_ filesystem path rather than
  the config-relative one, making compare-mode reports non-reproducible byte-for-byte across
  machines/checkouts. Fixed via `CompiledBaseline.reportPathRelative`; regression-covered by
  `pnpm examples:evidence:check` and `greenhouse.test.ts`, and documented in
  [ADR 0004](docs/adr/0004-exact-baseline-comparison.md).

## Deferred work and known limits

- **SARIF output is deliberately not implemented.** The report model
  (`axiom-report.v1`) and CLI/Action surface are structured so a SARIF renderer could be
  added as a new render target consuming the same value-free report, without changing
  evaluation logic -- but it is out of scope for this pass.
- **Command execution is not a sandbox.** Axiom bounds _how_ it invokes a consented command
  (timeout, output caps, process-tree termination, closed stdin, allowlisted env) but does
  not restrict what that command can do to the filesystem or network once it starts. See
  [`docs/threat-model.md`](docs/threat-model.md).
- **The invariant/selector grammar has no recursive/multi-level wildcard** and no arithmetic
  beyond equality/ordering -- a deliberate boundedness trade-off (see
  [ADR 0003](docs/adr/0003-safe-declarative-rules.md)), not an oversight.
- **No secrets management, no telemetry, no network access** in normal operation (see
  [ADR 0001](docs/adr/0001-provider-neutrality.md)) -- there is nothing to configure here
  because there is deliberately nothing to hold.
- **This repository is not published or deployed anywhere.** No package has been published,
  no Action has been listed on the GitHub Marketplace, and nothing here should be pushed to a
  remote or made public as part of this work -- see the top-level plan for the delivery
  constraints this build operated under.
- **Node 24 pinned, not yet tested against other majors.** `engines` fields across every
  `package.json` pin `>=24 <25`; nothing has been verified against Node 22/26.

## If you are picking this up next

1. Run the review commands above on a clean checkout to confirm the baseline described here
   still holds.
2. Read [`docs/threat-model.md`](docs/threat-model.md) and
   [`docs/adr/`](docs/adr) before changing anything in `packages/core/src/config`,
   `packages/core/src/engine/policy.ts`, `packages/core/src/redaction`, or
   `packages/core/src/runtime` -- these are the modules the threat model's controls actually
   live in.
3. If you touch `packages/core` or `packages/action/src`, rebuild and recommit the Action
   bundle (`pnpm build:action-bundle`) before `pnpm action:bundle:check` will pass.
4. If you touch anything that changes a check/compare finding, metric, or the baseline
   report's shape, regenerate the example evidence
   (`node examples/greenhouse-inspection/generate-evidence.mjs`, after `pnpm build`) and
   commit the result before `pnpm examples:evidence:check` will pass.
