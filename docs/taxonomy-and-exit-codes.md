# Finding taxonomy and exit codes

## Exit codes

Every axiom invocation (CLI or Action) resolves to exactly one of four exit codes, decided
centrally by [`exitCodeForError`](../packages/core/src/exit-code.ts) (for a thrown error) or
[`buildReport`](../packages/core/src/engine/build-report.ts) (for a completed evaluation) --
no adapter and no evaluation stage computes its own exit code.

| Code | Name               | Meaning                                                                                                                                                                     | Examples                                                                                                                                                                                |
| ---- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | `SUCCESS`          | Help/version, or a check/compare whose required contracts and regression thresholds all passed.                                                                             | `axiom --help`; a `check` where every case passed every stage.                                                                                                                          |
| `1`  | `CONTRACT_FAILURE` | A normal _outcome_ the evaluation engine decided -- never a thrown exception.                                                                                               | A schema/invariant/policy finding; a retry-exhausted case; a failed or insufficient-data baseline threshold.                                                                            |
| `2`  | `INVALID_INPUT`    | Invalid configuration, invocation, input envelope, or schema -- always a `ConfigError`, `InputEnvelopeError`, or `BoundsError`.                                             | Malformed `axiom.config.yaml`; an unsupported `version`; a config path escaping the config root; a malformed artifact/report envelope; a command source used without `--allow-command`. |
| `3`  | `INTERNAL_FAILURE` | I/O, spawn, timeout, output-overflow, or any unanticipated failure -- an `InternalError`, or any thrown value that is _not_ one of the three `AxiomError` subclasses above. | A command timeout, output overflow, non-zero exit, or termination signal; a file that cannot be opened; a genuine programming bug.                                                      |

**Why a bug can never look like exit `1`:** every anticipated failure extends the abstract
`AxiomError` class and carries its own pinned `exitCode` (`2` or `3`); anything else --
including Node's default uncaught-exception/unhandled-rejection behavior -- is classified as
`INTERNAL_FAILURE` by `exitCodeForError`'s fallback. A malformed candidate is _always_ a
decided outcome (exit `1`, produced by walking the evaluation pipeline to completion and
recording a finding); it is never the result of catching and reclassifying an exception.

The GitHub Action's underlying process only ever exits `0` or `1` (`main.ts`, via
`core.setFailed`) -- GitHub Actions itself has no runner-level concept of `2` vs. `3`. The
real `0`/`1`/`2`/`3` decision is always available from the `exit-code` output, set on both
the success path and the error path.

## Finding categories

A `Finding` (see [`docs/report-format.md`](report-format.md)) carries exactly one of six
stable categories:

| Category     | Produced by                                                              | Meaning                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `json`       | [`evaluate-attempt.ts`](../packages/core/src/engine/evaluate-attempt.ts) | The attempt's raw content did not parse as bounded JSON (or exceeded a decode bound). This is the _only_ place a candidate's own malformed JSON is a contract finding rather than an `InputEnvelopeError` -- see "malformed candidate vs. malformed envelope" below.                                                                                                                                |
| `schema`     | same                                                                     | The parsed document failed JSON Schema validation. `code` is `schema.<ajv-keyword>` (e.g. `schema.required`, `schema.enum`, `schema.maximum`); `pointer` is the sanitized, length-bounded RFC 6901 location.                                                                                                                                                                                        |
| `invariant`  | same                                                                     | A contract's `invariants[]` rule evaluated to `false`. `code` is always `invariant.failed`; `ruleId` names the specific rule.                                                                                                                                                                                                                                                                       |
| `policy`     | [`policy.ts`](../packages/core/src/engine/policy.ts)                     | A `forbidden.paths[]` or `forbidden.patterns[]` rule matched. `code` is `policy.forbidden-path`, `policy.forbidden-pattern`, or `policy.forbidden-pattern-key`; `ruleId` names the rule.                                                                                                                                                                                                            |
| `retry`      | [`run-check.ts`](../packages/core/src/engine/run-check.ts)               | A case that was actually eligible for more than one attempt (an artifact item recording multiple attempts, or a check whose configured `retries.maxAttempts > 1`) never passed within its budget. `code` is always `retry.exhausted`. **Never** emitted for a case that only ever had one attempt on offer, even if the _check's_ configured `maxAttempts` is greater than 1 -- see the note below. |
| `regression` | reserved                                                                 | Present in the schema's `findingCategory` enum for forward compatibility; not yet produced by any evaluation stage (a baseline regression is currently surfaced through `comparison.thresholds[].result`, not a `Finding`).                                                                                                                                                                         |

**Evaluation short-circuits per attempt:** `json -> schema -> invariant -> policy`, in that
order, stopping at the first failing stage -- a document that does not even match its schema
is not meaningfully evaluated against invariants/policy rules that assume that shape (see
`evaluate-attempt.ts`'s docstring and `computeMetrics`'s per-stage pass-rate property test,
which asserts `jsonPassRate >= schemaPassRate >= invariantPassRate >= policyPassRate` for
every generated attempt mix).

### Why `retry.exhausted` is scoped per case, not per check

A check's `retries.maxAttempts` is a _ceiling_: for an artifact source, the actual number of
attempts offered to a given case is `min(check.retries.maxAttempts, thatCase.attempts.length)`
-- an artifact item that only ever recorded one attempt is not "retried" just because the
check's configured ceiling happens to be higher. `retry.exhausted` is only emitted when the
specific case that failed was actually eligible for more than one attempt; otherwise it is
indistinguishable from an ordinary single-attempt failure and reporting it as an _exhausted
retry_ would be misleading. See
`packages/core/src/engine/run-check.test.ts` for the regression coverage.

### Malformed candidate vs. malformed envelope

| What is malformed                                                                            | Category             | Exit code |
| -------------------------------------------------------------------------------------------- | -------------------- | --------- |
| A candidate attempt's own `content` text (e.g. `attempts[0].content` is not valid JSON)      | `json` finding       | `1`       |
| The artifact _envelope_ itself (missing `artifactVersion`, wrong shape, a `caseId` mismatch) | `InputEnvelopeError` | `2`       |
| `axiom.config.yaml` (unparseable, unknown keys, unsupported `version`, ...)                  | `ConfigError`        | `2`       |
| A referenced JSON Schema file (not valid JSON, or not a valid JSON Schema)                   | `ConfigError`        | `2`       |
| A baseline or externally-supplied report file (fails `axiom-report.v1` validation)           | `InputEnvelopeError` | `2`       |

This is the plan's load-bearing distinction: a candidate's content is evaluated data, always
producing a decided outcome; everything that wraps or precedes that content (the envelope,
the config, the schema) is a precondition, and failing to satisfy it is an invalid-input
problem, never a contract finding.

## Comparison outcomes (`axiom compare`)

Independent of any per-check finding, each configured baseline threshold resolves to exactly
one of:

| Result              | Meaning                                                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pass`              | The metric satisfied its configured direction/amount, by exact fraction comparison.                                                                                                                                                                                   |
| `fail`              | It did not. Folds into the report's overall `status: "fail"` (exit `1`).                                                                                                                                                                                              |
| `insufficient-data` | The metric was absent from either report, or either report's denominator for it fell below `minDenominator`. Folds into `status: "error"` (still exit `1`) _only if nothing else failed_ -- not enough evidence to call it a pass, but never silently treated as one. |

See [`docs/configuration.md`](configuration.md#baseline-required-only-for-axiom-compare) and
[ADR 0004](adr/0004-exact-baseline-comparison.md).
