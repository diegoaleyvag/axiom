import type { CompiledBaselineThreshold } from '../domain/compiled-config.js';
import type { ThresholdDirection } from '../domain/config.js';
import type {
  AxiomReportV1,
  ComparisonThreshold,
  Metric,
  MetricId,
  ThresholdSample,
} from '../domain/report.js';
import { ConfigError } from '../errors.js';
import {
  compareFractions,
  fractionOf,
  parseExactDecimal,
  subtractFractions,
  type ExactFraction,
} from './decimal.js';

/**
 * Enforces the configured `baseline.population` compatibility gate *before* any threshold is
 * evaluated. `exact` requires the current run to have evaluated precisely the same cases as
 * the baseline (byte-identical `populationFingerprint`); `comparable` only requires the same
 * set of checks (available directly from both reports' `checks[].checkId`, so it does not
 * depend on decoding the opaque fingerprint). A mismatch is an invalid-invocation problem --
 * thrown as {@link ConfigError} (exit `2`), not folded into a report-embedded outcome.
 */
export function assertPopulationCompatible(
  current: AxiomReportV1,
  baseline: AxiomReportV1,
  population: 'exact' | 'comparable',
): void {
  const currentCheckIds = new Set(current.checks.map((check) => check.checkId));
  const baselineCheckIds = new Set(baseline.checks.map((check) => check.checkId));
  const sameCheckSet =
    currentCheckIds.size === baselineCheckIds.size &&
    [...currentCheckIds].every((id) => baselineCheckIds.has(id));

  if (!sameCheckSet) {
    throw new ConfigError(
      'config.population-mismatch',
      'The current run and the configured baseline report do not cover the same set of checks.',
    );
  }
  if (population === 'exact' && current.populationFingerprint !== baseline.populationFingerprint) {
    throw new ConfigError(
      'config.population-mismatch',
      'The current run and the configured baseline report do not have identical populations (population: "exact").',
    );
  }
}

function toSample(metric: Metric | undefined): ThresholdSample {
  return metric
    ? { numerator: metric.numerator, denominator: metric.denominator, value: metric.value }
    : { numerator: 0, denominator: 0, value: null };
}

function evaluateDirection(
  direction: ThresholdDirection,
  amount: ExactFraction,
  current: ExactFraction,
  baseline: ExactFraction,
): boolean {
  switch (direction) {
    case 'max-decrease':
      return compareFractions(subtractFractions(baseline, current), amount) <= 0;
    case 'max-increase':
      return compareFractions(subtractFractions(current, baseline), amount) <= 0;
    case 'min-value':
      return compareFractions(current, amount) >= 0;
    case 'max-value':
      return compareFractions(current, amount) <= 0;
    default: {
      const exhaustive: never = direction;
      throw new Error(`Unknown threshold direction: ${String(exhaustive)}`);
    }
  }
}

/**
 * Evaluates every configured baseline threshold against the freshly-computed current
 * metrics and the baseline report's stored metrics, by exact fraction cross-multiplication
 * (see `./decimal.ts`) -- never a binary float comparison. A threshold whose metric is
 * missing from either report, or whose current/baseline denominator falls below the
 * configured `minDenominator`, resolves to `"insufficient-data"` rather than silently
 * passing or failing on too little evidence.
 */
export function compareThresholds(
  current: AxiomReportV1,
  baseline: AxiomReportV1,
  thresholds: readonly CompiledBaselineThreshold[],
): readonly ComparisonThreshold[] {
  return thresholds.map((threshold) => {
    const currentMetric = current.metrics.find((metric) => metric.id === threshold.metric);
    const baselineMetric = baseline.metrics.find((metric) => metric.id === threshold.metric);
    const currentSample = toSample(currentMetric);
    const baselineSample = toSample(baselineMetric);

    const hasEnoughData =
      currentMetric !== undefined &&
      baselineMetric !== undefined &&
      currentMetric.denominator >= threshold.minDenominator &&
      baselineMetric.denominator >= threshold.minDenominator;

    const result = !hasEnoughData
      ? 'insufficient-data'
      : evaluateDirection(
            threshold.direction,
            parseExactDecimal(threshold.amount, `baseline threshold "${threshold.metric}" amount`),
            fractionOf(currentMetric.numerator, currentMetric.denominator),
            fractionOf(baselineMetric.numerator, baselineMetric.denominator),
          )
        ? 'pass'
        : 'fail';

    return {
      metric: threshold.metric as MetricId,
      direction: threshold.direction,
      amount: threshold.amount,
      current: currentSample,
      baseline: baselineSample,
      result,
    };
  });
}
