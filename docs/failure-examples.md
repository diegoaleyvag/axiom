# Failure examples

This document walks through the nine acceptance scenarios locked in
[`examples/greenhouse-inspection`](../examples/greenhouse-inspection) -- a wholly fictional
community-greenhouse volunteer inspection extraction (see
[`contracts/greenhouse-inspection.schema.json`](../examples/greenhouse-inspection/contracts/greenhouse-inspection.schema.json)).
Every finding shown below is taken verbatim from the committed, regenerable evidence at
[`examples/greenhouse-inspection/evidence/check-report.json`](../examples/greenhouse-inspection/evidence/check-report.json)
and
[`compare-report.json`](../examples/greenhouse-inspection/evidence/compare-report.json)
(`pnpm examples:evidence:check` fails CI if these ever drift from a fresh regeneration).

Run it yourself:

```bash
pnpm build
node packages/cli/dist/index.js check --config examples/greenhouse-inspection/axiom.config.yaml
# axiom: fail (exit 1)
node packages/cli/dist/index.js compare --config examples/greenhouse-inspection/axiom.config.yaml
# axiom: fail (exit 1)
```

## Scenario 1: valid golden ([`cases/01-valid-golden.json`](../examples/greenhouse-inspection/cases/01-valid-golden.json))

A fully schema-valid, invariant-satisfying, policy-clean inspection record. Produces **no
findings at all** for case `valid-golden` -- the baseline every other scenario is contrasted
against.

## Scenario 2: malformed candidate JSON ([`cases/02-malformed-json.json`](../examples/greenhouse-inspection/cases/02-malformed-json.json))

The file's raw bytes are not syntactically valid JSON.

```jsonc
{ "category": "json", "code": "json.invalid-json", "caseId": "malformed-json", "attempt": 1 }
```

This is a `json`-category **contract finding** (exit `1`), not an envelope/config error --
see [`docs/taxonomy-and-exit-codes.md`](taxonomy-and-exit-codes.md#malformed-candidate-vs-malformed-envelope).

## Scenario 3: missing required field ([`cases/03-missing-required-field.json`](../examples/greenhouse-inspection/cases/03-missing-required-field.json))

The document omits `zone` (a required top-level field).

```jsonc
{
  "category": "schema",
  "code": "schema.required",
  "pointer": "",
  "caseId": "missing-required-field",
  "attempt": 1,
}
```

`pointer` is `""` (the document root) because Ajv's `required` keyword reports the _missing
field's container_, not a path through the missing field itself.

## Scenario 4: enum/type violation ([`cases/04-enum-type-violation.json`](../examples/greenhouse-inspection/cases/04-enum-type-violation.json))

An observation's `status` is not one of the schema's enumerated values.

```jsonc
{
  "category": "schema",
  "code": "schema.enum",
  "pointer": "/observations/0/status",
  "caseId": "enum-type-violation",
  "attempt": 1,
}
```

## Scenario 5: numeric bound violation ([`cases/05-numeric-bound-violation.json`](../examples/greenhouse-inspection/cases/05-numeric-bound-violation.json))

An observation's `confidence` exceeds the schema's `maximum: 1`.

```jsonc
{
  "category": "schema",
  "code": "schema.maximum",
  "pointer": "/observations/0/confidence",
  "caseId": "numeric-bound-violation",
  "attempt": 1,
}
```

## Scenario 6: cross-field count invariant violation ([`cases/06-count-invariant-violation.json`](../examples/greenhouse-inspection/cases/06-count-invariant-violation.json))

`summary.totalObservations` does not equal the actual number of `observations[]` entries --
schema-valid on its own, but caught by the contract's `total-observations-match` invariant
(see [`docs/configuration.md`](configuration.md#invariant-and-policy-expressions) for the
expression itself).

```jsonc
{
  "category": "invariant",
  "code": "invariant.failed",
  "ruleId": "total-observations-match",
  "caseId": "count-invariant-violation",
  "attempt": 1,
}
```

## Scenario 7: synthetic forbidden-field/marker leak ([`cases/07-forbidden-leak.json`](../examples/greenhouse-inspection/cases/07-forbidden-leak.json))

Plants **two independent policy violations** with synthetic secret canaries
(`AXIOM_SYNTHETIC_SECRET_*`) that must never reach any report/log/annotation/snapshot:

```jsonc
{ "category": "policy", "code": "policy.forbidden-path", "ruleId": "no-internal-notes", "pointer": "/inspector/internalNotes", "caseId": "forbidden-leak", "attempt": 1 }
{ "category": "policy", "code": "policy.forbidden-pattern", "ruleId": "no-secret-marker", "pointer": "/observations/*/note", "caseId": "forbidden-leak", "attempt": 1 }
```

Note that **neither finding carries the secret canary value itself** -- only the rule id and
a pointer to _where_ it was found. `examples/greenhouse-inspection/greenhouse.test.ts` and
`packages/action/src/index.test.ts`'s "secret safety" tests both assert the marker string
never appears anywhere in the rendered report, CLI stdout, or Action annotations/outputs.

## Scenario 8: success only after the configured retry limit ([`cases/08-retry-success.json`](../examples/greenhouse-inspection/cases/08-retry-success.json), check `greenhouse-retry`, `retries.maxAttempts: 3`)

A three-attempt recorded envelope: attempt 1 is missing `zone` (a schema failure), attempt 2
has the wrong `summary.totalObservations` (an invariant failure), and attempt 3 finally
satisfies every stage. The **case passes overall** (`status: "pass"`), but the first two
attempts' failures remain on record as evidence that a retry was needed:

```jsonc
{ "category": "schema", "code": "schema.required", "pointer": "", "caseId": "greenhouse-retry-success", "attempt": 1 }
{ "category": "invariant", "code": "invariant.failed", "ruleId": "total-observations-match", "caseId": "greenhouse-retry-success", "attempt": 2 }
```

No `retry.exhausted` finding is produced here, because the case _did_ eventually pass --
`retry.exhausted` is reserved for a case that used every attempt it was eligible for and
still never passed (see
[`docs/taxonomy-and-exit-codes.md`](taxonomy-and-exit-codes.md#why-retryexhausted-is-scoped-per-case-not-per-check)).

## Scenario 9: same-population baseline regression ([`baseline/baseline-report.json`](../examples/greenhouse-inspection/baseline/baseline-report.json), via `axiom compare`)

The committed baseline recorded `finalPassRate: 8/8` (every case passed); the current input
(the same eight `greenhouse-primary` cases as scenarios 1-8, minus the retry check) only
achieves `2/8`. The configured threshold (`max-decrease`, allowed `amount: "0.10"`) fails:

```jsonc
{
  "metric": "finalPassRate",
  "direction": "max-decrease",
  "amount": "0.10",
  "current": { "numerator": 2, "denominator": 8, "value": "0.250000" },
  "baseline": { "numerator": 8, "denominator": 8, "value": "1.000000" },
  "result": "fail",
}
```

`population: comparable` only required the same _set_ of check ids between the two reports;
see [`docs/configuration.md`](configuration.md#baseline-required-only-for-axiom-compare) for
the difference from `population: exact`.

## Aggregate metrics for the full `check` run

From [`evidence/check-report.json`](../examples/greenhouse-inspection/evidence/check-report.json)
(8 cases across both checks, 10 total attempts including the retry check's 3): `finalPassRate
2/8`, `firstPassRate 1/8`, `retryRate 1/8`, `meanAttempts 10/8`, and the per-stage rates
`jsonPassRate 9/10 -> schemaPassRate 5/10 -> invariantPassRate 3/10 -> policyPassRate 2/10`
-- non-increasing, exactly as the pipeline's short-circuit-per-stage design predicts (see
[`docs/report-format.md`](report-format.md#metrics)).
