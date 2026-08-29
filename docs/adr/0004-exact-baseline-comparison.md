# ADR 0004: Exact-fraction baseline comparison, never binary floats

## Status

Accepted.

## Context

`axiom compare` decides whether a metric (a pass rate, a mean-attempts count) has regressed
against a configured baseline by more than an allowed amount. Metrics are naturally rational
numbers (`numerator / denominator`, e.g. `2/8`). The obvious implementation -- convert both
sides to a JavaScript `number` and compare with `<`/`<=` -- is a binary float comparison, and
binary floats cannot represent most decimal fractions exactly. `0.1 + 0.2 !== 0.3` is the
canonical example; the same class of error can silently move a threshold's pass/fail decision
at exactly the boundary a config author configured (e.g. an allowed decrease of `"0.05"`
compared against a computed rate that is float-adjacent to, but not exactly, that boundary).
A regression gate that is sometimes wrong by float epsilon at the boundary is worse than
useless: it erodes trust in every result, not just the boundary cases.

## Decision

Every quantity that feeds a threshold decision is either:

- an **exact integer** (`Metric.numerator`/`denominator`, always integers, never
  a computed float ratio stored as the source of truth -- see
  [`domain/report.ts`](../../packages/core/src/domain/report.ts)), or
- an **exact fixed-decimal string** (`ComparisonThreshold.amount`, e.g. `"0.10"`), parsed
  into a `BigInt`-based `ExactFraction`
  ([`packages/core/src/engine/decimal.ts`](../../packages/core/src/engine/decimal.ts)'s
  `parseExactDecimal`) -- never `Number.parseFloat` for anything that affects a decision.

Every comparison is **cross-multiplication** on those `BigInt` fractions
(`compareFractions`: `a.numerator * b.denominator` vs. `b.numerator * a.denominator`), never
a division-then-compare on floats. The only place a float-shaped value appears at all is the
final, purely cosmetic `Metric.value`/`ThresholdSample.value` display string, computed by
`formatRatio`'s `BigInt` long division -- and even that is a string, never fed back into a
comparison.

`compare.test.ts`'s property tests assert this at the actual boundary: a `max-decrease`
threshold set to exactly the observed decrease always passes, and one unit tighter always
fails, generated across a wide integer range (`numRuns: 300`) -- and a dedicated adversarial
test asserts `1/3` (as `numerator: 1, denominator: 3`) compares as strictly greater than
`0.333333` (as `numerator: 333333, denominator: 1000000`) under a zero-tolerance
`max-increase` threshold, which only holds under exact fraction arithmetic; a float
comparison could let the two round-trip as equal.

Two further consequences of "exact" follow the same principle:

- **Population compatibility** (`assertPopulationCompatible`,
  [`compare.ts`](../../packages/core/src/engine/compare.ts)) is either `comparable`
  (identical _set_ of check ids, compared as sets, never string-prefix or fuzzy matching) or
  `exact` (additionally requires a byte-identical `populationFingerprint` -- a SHA-256 hash of
  every check's sorted case ids, never a heuristic "looks similar" check).
- **The baseline report path itself, as recorded in the produced report
  (`comparison.baselineReportPath`), is the config-relative path exactly as authored, never
  the resolved absolute filesystem path** -- an absolute path is a property of the machine
  running axiom, not of the config/fixtures being evaluated, and embedding it would make the
  produced report non-reproducible byte-for-byte across checkouts/machines despite being
  built from identical inputs. `CompiledBaseline` therefore carries both
  `reportPath` (absolute, used to actually read the file, and real-path/symlink-contained
  before that read -- see [`docs/threat-model.md`](../threat-model.md)) and
  `reportPathRelative` (used only for this display field). This is directly enforced by
  `pnpm examples:evidence:check`, which regenerates the committed
  `examples/greenhouse-inspection` evidence in an out-of-tree temporary directory (a
  different absolute path than the committed original) and byte-diffs the result.

## Consequences

- **Positive:** a threshold decision is reproducible and auditable independent of floating
  point rounding; two engineers (or CI runs on different hardware) evaluating the same
  config/input always reach the same pass/fail/insufficient-data result at every boundary.
- **Positive:** a compare-mode report is byte-identical regardless of which machine or
  checkout path produced it, which is what makes committed evidence regeneration
  (`pnpm examples:evidence:check`) a meaningful, non-flaky gate.
- **Negative:** `BigInt` arithmetic and fixed-decimal string parsing are more code than
  `Number` comparison, and every new numeric field that could ever feed a threshold decision
  must be deliberately routed through `decimal.ts` rather than compared directly -- a
  reviewer needs to specifically check for a stray `<`/`<=` on two `Metric.value` strings (or
  worse, `Number(metric.value)`) as a regression class of its own.
