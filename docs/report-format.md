# Report format (`axiom-report.v1`)

Every `axiom check`/`compare`/`report` invocation produces one canonical report, validated
against [`schemas/axiom-report.v1.schema.json`](../schemas/axiom-report.v1.schema.json) and
rendered deterministically to JSON
([`render/json.ts`](../packages/core/src/engine/render/json.ts)) and Markdown
([`render/markdown.ts`](../packages/core/src/engine/render/markdown.ts)). The TypeScript
shape lives at
[`packages/core/src/domain/report.ts`](../packages/core/src/domain/report.ts).

The report is deliberately **value-free**: it never carries the candidate value, a raw Ajv
error's `data`/`params`, or captured stdout/stderr -- only stable codes/categories, a safe
pointer, identifiers, and exact counts. See [`docs/threat-model.md`](threat-model.md) for
why, and [`docs/taxonomy-and-exit-codes.md`](taxonomy-and-exit-codes.md) for what each
`Finding.category`/`code` means.

## Top-level shape

```jsonc
{
  "reportVersion": 1,
  "metricVersion": 1,
  "toolVersion": "0.1.0",
  "status": "pass", // "pass" | "fail" | "error"
  "exitCode": 0, // 0 | 1 | 2 | 3
  "configFingerprint": "…", // sha256 of the raw config file bytes
  "populationFingerprint": "…", // sha256 of every check's sorted case ids
  "checks": [/* CheckReport[] */],
  "metrics": [/* Metric[] */],
  "comparison": {/* ComparisonReport, only present for axiom compare */},
}
```

`status`/`exitCode` are always decided together, in one place
([`buildReport`](../packages/core/src/engine/build-report.ts)):

- `"fail"` (`1`) if any check failed, or any comparison threshold resolved to `"fail"`.
- `"error"` (`1`) if nothing failed outright but a comparison threshold resolved to
  `"insufficient-data"` -- not enough evidence to call it a pass, but not a concrete
  violation either. Still exit `1`, not `2`/`3`: this is a decided evidentiary outcome, never
  a thrown exception.
- `"pass"` (`0`) otherwise.

## `checks[]` and `Finding`

```jsonc
{
  "checkId": "greenhouse-primary",
  "contractId": "greenhouse-inspection",
  "status": "fail", // "pass" | "fail"
  "findings": [
    {
      "code": "schema.enum",
      "category": "schema", // "json" | "schema" | "invariant" | "policy" | "retry" | "regression"
      "checkId": "greenhouse-primary",
      "caseId": "enum-type-violation",
      "attempt": 1, // 1-based
      "ruleId": "…", // present for invariant/policy findings
      "pointer": "/observations/0/status", // present for schema/invariant-path/policy findings
    },
  ],
}
```

`ruleId` and `checkId`/`caseId` are always config-authored identifiers matching
`^[A-Za-z][A-Za-z0-9_-]{0,63}$` -- never derived from candidate content, so they need no
redaction beyond the identity check above. `pointer` is the one field that can echo a
candidate-controlled string (an Ajv `instancePath` segment, or an object key matched by a
`forbidden.patterns[].target: "keys"` rule); it is always sanitized (RFC 6901 escaped,
length-bounded per segment, segment-count-bounded) and redaction-checked _before_ the finding
is created -- see [`docs/threat-model.md`](threat-model.md#7-value-free-reports-and-defense-in-depth-redaction).

## `metrics[]`

Every metric is an **exact integer** `numerator`/`denominator` pair; `value` is a fixed
6-decimal string computed by `BigInt` long division
([`formatRatio`](../packages/core/src/engine/decimal.ts)), or `null` when `denominator` is
`0` (never `NaN`/`Infinity`).

| `id`                | Denominator    | Meaning                                                                                           |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `finalPassRate`     | total cases    | Cases whose _last_ attempt passed every stage.                                                    |
| `firstPassRate`     | total cases    | Cases that passed on their _first_ attempt (no retry needed).                                     |
| `retryRate`         | total cases    | Cases that used more than one attempt.                                                            |
| `meanAttempts`      | total cases    | Sum of attempts actually used across all cases, per case (can exceed 1).                          |
| `jsonPassRate`      | total attempts | Attempts that parsed as bounded JSON.                                                             |
| `schemaPassRate`    | total attempts | Attempts that additionally passed schema validation.                                              |
| `invariantPassRate` | total attempts | Attempts that additionally passed every invariant.                                                |
| `policyPassRate`    | total attempts | Attempts that additionally passed every forbidden-path/pattern rule (i.e. a fully clean attempt). |

The four per-stage rates are non-increasing (`jsonPassRate >= schemaPassRate >=
invariantPassRate >= policyPassRate`) because evaluation short-circuits at the first failing
stage per attempt -- passing a later stage implies passing every earlier one. This is a
property-tested invariant, not just documentation (see
`packages/core/src/engine/metrics.test.ts`).

## `comparison` (only for `axiom compare`)

```jsonc
{
  "baselineReportPath": "baseline/baseline-report.json", // config-relative, never absolute
  "population": "comparable", // "exact" | "comparable"
  "thresholds": [
    {
      "metric": "finalPassRate",
      "direction": "max-decrease", // "max-decrease" | "max-increase" | "min-value" | "max-value"
      "amount": "0.10",
      "current": { "numerator": 2, "denominator": 8, "value": "0.250000" },
      "baseline": { "numerator": 8, "denominator": 8, "value": "1.000000" },
      "result": "fail", // "pass" | "fail" | "insufficient-data"
    },
  ],
}
```

`baselineReportPath` is always the `baseline.report` path exactly as authored in the config
(config-relative), never the resolved absolute filesystem path -- otherwise the same config
and fixtures would produce a different report depending on where the repository happens to
be checked out, breaking the "byte-identical evidence" contract
`pnpm examples:evidence:check` enforces. See
[ADR 0004](adr/0004-exact-baseline-comparison.md).

## Determinism

Given the same config and input, the JSON rendering is byte-identical: object keys are
sorted alphabetically at every nesting level (`render/json.ts`'s `stableStringify`),
independent of any upstream property insertion order, and the file always ends with exactly
one trailing newline. The committed
[`examples/greenhouse-inspection/evidence`](../examples/greenhouse-inspection/evidence)
directory is regenerated by
[`examples/greenhouse-inspection/generate-evidence.mjs`](../examples/greenhouse-inspection/generate-evidence.mjs)
and verified never to drift by `pnpm examples:evidence:check`
([`scripts/verify-example-evidence.mjs`](../scripts/verify-example-evidence.mjs)), which
regenerates it in an out-of-tree temporary directory and byte-diffs the result -- this is
also what catches a config-relative-vs-absolute-path regression like the one described above.

## `axiom report`'s revalidation contract

`axiom report --report <path>` never re-evaluates any candidate artifact and never re-runs
any check: it (1) fully revalidates the supplied file against this schema (an externally
supplied report is never trusted), (2) applies the defensive redaction pass again using the
_current_ config's redaction rules, (3) deterministically re-renders JSON/Markdown, and (4)
mirrors the report's own `status`/`exitCode` verbatim. This is also the code path a
configured `baseline.report` goes through inside `axiom compare`.
