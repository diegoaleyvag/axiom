import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AxiomReportV1, Metric } from '../domain/report.js';
import { ConfigError } from '../errors.js';
import { assertPopulationCompatible, compareThresholds } from './compare.js';

function report(overrides: Partial<AxiomReportV1> = {}): AxiomReportV1 {
  return {
    reportVersion: 1,
    metricVersion: 1,
    toolVersion: '0.1.0',
    status: 'pass',
    exitCode: 0,
    configFingerprint: 'cfg',
    populationFingerprint: 'pop-a',
    checks: [{ checkId: 'check-1', contractId: 'contract-1', status: 'pass', findings: [] }],
    metrics: [],
    ...overrides,
  };
}

function metric(id: Metric['id'], numerator: number, denominator: number): Metric {
  return {
    id,
    numerator,
    denominator,
    value: denominator === 0 ? null : (numerator / denominator).toFixed(6),
  };
}

describe('assertPopulationCompatible', () => {
  it('"comparable" only requires the same set of checks, ignoring the fingerprint', () => {
    const current = report({ populationFingerprint: 'pop-a' });
    const baseline = report({ populationFingerprint: 'pop-b' });
    expect(() => assertPopulationCompatible(current, baseline, 'comparable')).not.toThrow();
  });

  it('"exact" additionally requires an identical populationFingerprint', () => {
    const current = report({ populationFingerprint: 'pop-a' });
    const baseline = report({ populationFingerprint: 'pop-b' });
    expect(() => assertPopulationCompatible(current, baseline, 'exact')).toThrow(ConfigError);

    const sameBaseline = report({ populationFingerprint: 'pop-a' });
    expect(() => assertPopulationCompatible(current, sameBaseline, 'exact')).not.toThrow();
  });

  it('rejects any population when the check sets differ', () => {
    const current = report({
      checks: [{ checkId: 'check-1', contractId: 'c', status: 'pass', findings: [] }],
    });
    const baseline = report({
      checks: [{ checkId: 'check-2', contractId: 'c', status: 'pass', findings: [] }],
    });
    expect(() => assertPopulationCompatible(current, baseline, 'comparable')).toThrow(ConfigError);
  });
});

describe('compareThresholds', () => {
  it('"max-decrease": fails when the metric drops by more than the allowed amount', () => {
    const current = report({ metrics: [metric('firstPassRate', 80, 100)] });
    const baseline = report({ metrics: [metric('firstPassRate', 90, 100)] });
    const [result] = compareThresholds(current, baseline, [
      { metric: 'firstPassRate', direction: 'max-decrease', amount: '0.05', minDenominator: 1 },
    ]);
    // baseline 0.9 -> current 0.8 is a 0.1 decrease, exceeding the allowed 0.05.
    expect(result?.result).toBe('fail');
  });

  it('"max-decrease": passes when the decrease is within the allowed amount', () => {
    const current = report({ metrics: [metric('firstPassRate', 88, 100)] });
    const baseline = report({ metrics: [metric('firstPassRate', 90, 100)] });
    const [result] = compareThresholds(current, baseline, [
      { metric: 'firstPassRate', direction: 'max-decrease', amount: '0.05', minDenominator: 1 },
    ]);
    expect(result?.result).toBe('pass');
  });

  it('"min-value": compares only the current value against the floor, ignoring the baseline', () => {
    const current = report({ metrics: [metric('finalPassRate', 95, 100)] });
    const baseline = report({ metrics: [metric('finalPassRate', 10, 100)] });
    const [result] = compareThresholds(current, baseline, [
      { metric: 'finalPassRate', direction: 'min-value', amount: '0.9', minDenominator: 1 },
    ]);
    expect(result?.result).toBe('pass');
  });

  it('resolves to "insufficient-data" below the configured minDenominator', () => {
    const current = report({ metrics: [metric('finalPassRate', 1, 1)] });
    const baseline = report({ metrics: [metric('finalPassRate', 1, 1)] });
    const [result] = compareThresholds(current, baseline, [
      { metric: 'finalPassRate', direction: 'min-value', amount: '0.5', minDenominator: 20 },
    ]);
    expect(result?.result).toBe('insufficient-data');
  });

  it('resolves to "insufficient-data" when the metric is entirely absent from a report', () => {
    const current = report({ metrics: [] });
    const baseline = report({ metrics: [metric('finalPassRate', 1, 1)] });
    const [result] = compareThresholds(current, baseline, [
      { metric: 'finalPassRate', direction: 'min-value', amount: '0.5', minDenominator: 1 },
    ]);
    expect(result?.result).toBe('insufficient-data');
    expect(result?.current).toEqual({ numerator: 0, denominator: 0, value: null });
  });

  it('compares using exact fractions, never a binary float, at an adversarial boundary', () => {
    // 1/3 vs 0.333333 differ beyond float epsilon in exact-fraction terms.
    const current = report({ metrics: [metric('meanAttempts', 1, 3)] });
    const baseline = report({ metrics: [metric('meanAttempts', 333333, 1000000)] });
    const [result] = compareThresholds(current, baseline, [
      { metric: 'meanAttempts', direction: 'max-increase', amount: '0', minDenominator: 1 },
    ]);
    // current (1/3) is exactly greater than baseline (0.333333), a nonzero increase, so a
    // zero-tolerance "max-increase" threshold must fail -- this only holds with exact
    // fraction math, not a float comparison where 1/3 might round-trip equal to 0.333333.
    expect(result?.result).toBe('fail');
  });
});

/** Formats an integer 0..1000 as an exact thousandths decimal string, e.g. 37 -> "0.037". */
function thousandths(n: number): string {
  const whole = Math.trunc(n / 1000);
  const frac = Math.abs(n % 1000)
    .toString()
    .padStart(3, '0');
  return `${whole}.${frac}`;
}

describe('compareThresholds: property (exact boundaries and denominator gating)', () => {
  it('gates strictly on minDenominator: "insufficient-data" iff either denominator falls short', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (currentDenominator, baselineDenominator, minDenominator) => {
          const current = report({
            metrics: [metric('finalPassRate', 0, currentDenominator)],
          });
          const baseline = report({
            metrics: [metric('finalPassRate', 0, baselineDenominator)],
          });
          const [result] = compareThresholds(current, baseline, [
            { metric: 'finalPassRate', direction: 'min-value', amount: '0', minDenominator },
          ]);

          const expectInsufficient =
            currentDenominator < minDenominator || baselineDenominator < minDenominator;
          expect(result?.result === 'insufficient-data').toBe(expectInsufficient);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('"max-decrease": an exact decrease equal to the allowed amount always passes; one unit more always fails', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (currentNumerator, decrease) => {
          const baselineNumerator = currentNumerator + decrease;
          fc.pre(baselineNumerator <= 1000);

          const current = report({ metrics: [metric('finalPassRate', currentNumerator, 1000)] });
          const baseline = report({ metrics: [metric('finalPassRate', baselineNumerator, 1000)] });

          const [exact] = compareThresholds(current, baseline, [
            {
              metric: 'finalPassRate',
              direction: 'max-decrease',
              amount: thousandths(decrease),
              minDenominator: 1,
            },
          ]);
          expect(exact?.result).toBe('pass');

          if (decrease > 0) {
            const [tighter] = compareThresholds(current, baseline, [
              {
                metric: 'finalPassRate',
                direction: 'max-decrease',
                amount: thousandths(decrease - 1),
                minDenominator: 1,
              },
            ]);
            expect(tighter?.result).toBe('fail');
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('"min-value": current exactly at the floor passes; one unit below fails', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (floor) => {
        const atFloor = report({ metrics: [metric('finalPassRate', floor, 1000)] });
        const belowFloor = report({ metrics: [metric('finalPassRate', floor - 1, 1000)] });
        const baseline = report({ metrics: [metric('finalPassRate', 0, 1000)] });

        const [pass] = compareThresholds(atFloor, baseline, [
          {
            metric: 'finalPassRate',
            direction: 'min-value',
            amount: thousandths(floor),
            minDenominator: 1,
          },
        ]);
        expect(pass?.result).toBe('pass');

        const [fail] = compareThresholds(belowFloor, baseline, [
          {
            metric: 'finalPassRate',
            direction: 'min-value',
            amount: thousandths(floor),
            minDenominator: 1,
          },
        ]);
        expect(fail?.result).toBe('fail');
      }),
      { numRuns: 300 },
    );
  });

  it('"max-value": current exactly at the ceiling passes; one unit above fails', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999 }), (ceiling) => {
        const atCeiling = report({ metrics: [metric('finalPassRate', ceiling, 1000)] });
        const aboveCeiling = report({ metrics: [metric('finalPassRate', ceiling + 1, 1000)] });
        const baseline = report({ metrics: [metric('finalPassRate', 0, 1000)] });

        const [pass] = compareThresholds(atCeiling, baseline, [
          {
            metric: 'finalPassRate',
            direction: 'max-value',
            amount: thousandths(ceiling),
            minDenominator: 1,
          },
        ]);
        expect(pass?.result).toBe('pass');

        const [fail] = compareThresholds(aboveCeiling, baseline, [
          {
            metric: 'finalPassRate',
            direction: 'max-value',
            amount: thousandths(ceiling),
            minDenominator: 1,
          },
        ]);
        expect(fail?.result).toBe('fail');
      }),
      { numRuns: 300 },
    );
  });
});
