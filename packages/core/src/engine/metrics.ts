import type { Finding, Metric, MetricId } from '../domain/report.js';
import { formatRatio } from './decimal.js';
import type { CaseOutcome } from './run-case.js';

const STAGE_ORDER: Record<'json' | 'schema' | 'invariant' | 'policy', number> = {
  json: 0,
  schema: 1,
  invariant: 2,
  policy: 3,
};

/**
 * Every attempt's findings share one category (the pipeline in `./evaluate-attempt.ts`
 * short-circuits at the first failing stage), so the highest stage index an attempt reached
 * -- `-1` for "failed at json", up to `3` for "passed every stage" -- is fully recoverable
 * from just the first finding's category (or its absence).
 */
function reachedStageIndex(findings: readonly Finding[]): number {
  if (findings.length === 0) return 3;
  const category = findings[0]?.category;
  const failedAtStage =
    category && category in STAGE_ORDER ? STAGE_ORDER[category as keyof typeof STAGE_ORDER] : 0;
  return failedAtStage - 1;
}

/**
 * Aggregates the plan's exact metric set from every case's outcome across every check.
 * `json`/`schema`/`invariant`/`policy` pass rates are per-*attempt* (their denominator is
 * every attempt actually evaluated, not every case); every other metric is per-*case*.
 * Every numerator/denominator pair is an exact integer count -- `formatRatio` renders the
 * display `value` using `BigInt` long division, never a binary float division.
 */
export function computeMetrics(
  caseOutcomesByCheck: readonly (readonly CaseOutcome[])[],
): readonly Metric[] {
  const cases = caseOutcomesByCheck.flat();
  const totalCases = cases.length;
  const attempts = cases.flatMap((outcome) => outcome.attempts);
  const totalAttempts = attempts.length;

  const finalPassed = cases.filter((outcome) => outcome.passed).length;
  const firstPassed = cases.filter((outcome) => outcome.firstAttemptPassed).length;
  const retried = cases.filter((outcome) => outcome.attemptsUsed > 1).length;
  const totalAttemptsUsed = cases.reduce((sum, outcome) => sum + outcome.attemptsUsed, 0);

  const stageIndices = attempts.map((attempt) => reachedStageIndex(attempt.findings));
  const jsonPassed = stageIndices.filter((index) => index >= 0).length;
  const schemaPassed = stageIndices.filter((index) => index >= 1).length;
  const invariantPassed = stageIndices.filter((index) => index >= 2).length;
  const policyPassed = stageIndices.filter((index) => index >= 3).length;

  const entries: ReadonlyArray<readonly [MetricId, number, number]> = [
    ['finalPassRate', finalPassed, totalCases],
    ['firstPassRate', firstPassed, totalCases],
    ['retryRate', retried, totalCases],
    ['jsonPassRate', jsonPassed, totalAttempts],
    ['schemaPassRate', schemaPassed, totalAttempts],
    ['invariantPassRate', invariantPassed, totalAttempts],
    ['policyPassRate', policyPassed, totalAttempts],
    ['meanAttempts', totalAttemptsUsed, totalCases],
  ];

  return entries.map(([id, numerator, denominator]) => ({
    id,
    numerator,
    denominator,
    value: formatRatio(numerator, denominator),
  }));
}
