import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Finding } from '../domain/report.js';
import { computeMetrics } from './metrics.js';
import type { CaseOutcome } from './run-case.js';

function finding(category: Finding['category']): Finding {
  return { code: `${category}.x`, category, checkId: 'c', caseId: 'k', attempt: 1 };
}

function caseOutcome(attemptFindings: readonly (readonly Finding['category'][])[]): CaseOutcome {
  const attempts = attemptFindings.map((categories, index) => ({
    attempt: index + 1,
    findings: categories.map((category) => finding(category)),
    passed: categories.length === 0,
  }));
  const last = attempts.at(-1);
  return {
    caseId: 'k',
    attempts,
    passed: last?.passed ?? false,
    attemptsUsed: attempts.length,
    firstAttemptPassed: attempts[0]?.passed ?? false,
  };
}

function metric(metrics: ReturnType<typeof computeMetrics>, id: string) {
  return metrics.find((m) => m.id === id);
}

describe('computeMetrics', () => {
  it('computes exact case-level rates across a mix of first-pass, retried, and failed cases', () => {
    const cases = [
      caseOutcome([[]]), // first-attempt pass
      caseOutcome([['schema'], []]), // fails once, then passes (retry used)
      caseOutcome([['invariant'], ['policy']]), // never passes, exhausts 2 attempts
    ];

    const metrics = computeMetrics([cases]);

    expect(metric(metrics, 'finalPassRate')).toMatchObject({ numerator: 2, denominator: 3 });
    expect(metric(metrics, 'firstPassRate')).toMatchObject({ numerator: 1, denominator: 3 });
    expect(metric(metrics, 'retryRate')).toMatchObject({ numerator: 2, denominator: 3 });
    expect(metric(metrics, 'meanAttempts')).toMatchObject({ numerator: 5, denominator: 3 });
  });

  it('computes per-attempt stage pass rates independent of case-level outcome', () => {
    // 4 attempts total: one clean pass, one json failure, one schema failure, one invariant failure.
    const cases = [
      caseOutcome([[]]),
      caseOutcome([['json']]),
      caseOutcome([['schema']]),
      caseOutcome([['invariant']]),
    ];
    const metrics = computeMetrics([cases]);

    expect(metric(metrics, 'jsonPassRate')).toMatchObject({ numerator: 3, denominator: 4 });
    expect(metric(metrics, 'schemaPassRate')).toMatchObject({ numerator: 2, denominator: 4 });
    expect(metric(metrics, 'invariantPassRate')).toMatchObject({ numerator: 1, denominator: 4 });
    expect(metric(metrics, 'policyPassRate')).toMatchObject({ numerator: 1, denominator: 4 });
  });

  it('every metric is null-valued with a zero denominator when there are no cases at all', () => {
    const metrics = computeMetrics([]);
    for (const m of metrics) {
      expect(m.denominator).toBe(0);
      expect(m.value).toBeNull();
    }
  });
});

const STAGE_CATEGORY = fc.constantFrom<Finding['category']>(
  'json',
  'schema',
  'invariant',
  'policy',
);
/** Zero-length = a passing attempt; otherwise a single failing attempt at the given stage. */
const ATTEMPT_ARB = fc.oneof(
  fc.constant([] as Finding['category'][]),
  STAGE_CATEGORY.map((c) => [c]),
);
const CASE_ARB = fc.array(ATTEMPT_ARB, { minLength: 1, maxLength: 5 });

describe('computeMetrics: property (report count consistency)', () => {
  it('every metric numerator/denominator pair is internally consistent, exact, and monotonic across stages', () => {
    fc.assert(
      fc.property(fc.array(CASE_ARB, { minLength: 0, maxLength: 20 }), (casesSpec) => {
        const cases = casesSpec.map((attemptFindings) => caseOutcome(attemptFindings));
        const metrics = computeMetrics([cases]);
        const totalCases = cases.length;
        const totalAttempts = cases.reduce((sum, c) => sum + c.attempts.length, 0);

        const byId = new Map(metrics.map((m) => [m.id, m]));

        // Every metric's numerator is a non-negative exact count. Every metric except
        // "meanAttempts" is a genuine rate (numerator <= denominator); "meanAttempts" is a
        // mean attempt count per case, which can exceed 1 whenever any case retried, so it is
        // instead bounded by the fixture's maximum attempts-per-case (5).
        for (const m of metrics) {
          expect(m.numerator).toBeGreaterThanOrEqual(0);
          expect(m.numerator).toBeLessThanOrEqual(
            m.id === 'meanAttempts' ? m.denominator * 5 : m.denominator,
          );
          expect(m.value === null).toBe(m.denominator === 0);
        }

        // Case-scoped metrics share the total case count as their denominator.
        for (const id of ['finalPassRate', 'firstPassRate', 'retryRate', 'meanAttempts'] as const) {
          expect(byId.get(id)?.denominator).toBe(totalCases);
        }
        // Attempt-scoped (per-stage) metrics share the total attempt count as their denominator.
        for (const id of [
          'jsonPassRate',
          'schemaPassRate',
          'invariantPassRate',
          'policyPassRate',
        ] as const) {
          expect(byId.get(id)?.denominator).toBe(totalAttempts);
        }

        // finalPassRate's numerator is exactly the count of cases whose last attempt passed.
        const finalPassed = cases.filter((c) => c.passed).length;
        expect(byId.get('finalPassRate')?.numerator).toBe(finalPassed);

        // meanAttempts' numerator is exactly the sum of attempts actually used.
        const totalUsed = cases.reduce((sum, c) => sum + c.attemptsUsed, 0);
        expect(byId.get('meanAttempts')?.numerator).toBe(totalUsed);

        // The staged pipeline short-circuits: passing a later stage implies passing every
        // earlier one, so per-attempt pass counts are non-increasing json >= schema >=
        // invariant >= policy.
        const json = byId.get('jsonPassRate')?.numerator ?? 0;
        const schema = byId.get('schemaPassRate')?.numerator ?? 0;
        const invariant = byId.get('invariantPassRate')?.numerator ?? 0;
        const policy = byId.get('policyPassRate')?.numerator ?? 0;
        expect(json).toBeGreaterThanOrEqual(schema);
        expect(schema).toBeGreaterThanOrEqual(invariant);
        expect(invariant).toBeGreaterThanOrEqual(policy);

        // An attempt with zero findings passed every stage, including policy (the last one).
        const cleanAttempts = cases
          .flatMap((c) => c.attempts)
          .filter((a) => a.findings.length === 0);
        expect(policy).toBe(cleanAttempts.length);
      }),
      { numRuns: 300 },
    );
  });
});
