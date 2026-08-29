# Axiom Report

- Status: **fail**
- Exit code: 1
- Tool version: 0.1.0
- Config fingerprint: `e291604d1ce7b0f5a490af2f3e3491bcc64303fd6d510d8fe144c9b9f16ebfb8`
- Population fingerprint: `20afc856be16de32f7c05551610199a223b824153cdabbead188690d4a476396`

## Checks

| Check | Contract | Status | Findings |
| --- | --- | --- | --- |
| greenhouse-primary | greenhouse-inspection | fail | 7 |
| greenhouse-retry | greenhouse-inspection | pass | 2 |

## Findings

| Check | Case | Attempt | Category | Code | Rule | Pointer |
| --- | --- | --- | --- | --- | --- | --- |
| greenhouse-primary | malformed-json | 1 | json | json.invalid-json |  |  |
| greenhouse-primary | missing-required-field | 1 | schema | schema.required |  |  |
| greenhouse-primary | enum-type-violation | 1 | schema | schema.enum |  | /observations/0/status |
| greenhouse-primary | numeric-bound-violation | 1 | schema | schema.maximum |  | /observations/0/confidence |
| greenhouse-primary | count-invariant-violation | 1 | invariant | invariant.failed | total-observations-match |  |
| greenhouse-primary | forbidden-leak | 1 | policy | policy.forbidden-path | no-internal-notes | /inspector/internalNotes |
| greenhouse-primary | forbidden-leak | 1 | policy | policy.forbidden-pattern | no-secret-marker | /observations/*/note |
| greenhouse-retry | greenhouse-retry-success | 1 | schema | schema.required |  |  |
| greenhouse-retry | greenhouse-retry-success | 2 | invariant | invariant.failed | total-observations-match |  |

## Metrics

| Metric | Numerator | Denominator | Value |
| --- | --- | --- | --- |
| finalPassRate | 2 | 8 | 0.250000 |
| firstPassRate | 1 | 8 | 0.125000 |
| retryRate | 1 | 8 | 0.125000 |
| jsonPassRate | 9 | 10 | 0.900000 |
| schemaPassRate | 5 | 10 | 0.500000 |
| invariantPassRate | 3 | 10 | 0.300000 |
| policyPassRate | 2 | 10 | 0.200000 |
| meanAttempts | 10 | 8 | 1.250000 |

