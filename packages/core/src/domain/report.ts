import type { ThresholdDirection } from './config.js';

/**
 * The canonical, versioned report model (`schemas/axiom-report.v1.schema.json`). Kept
 * deliberately value-free: a {@link Finding} carries a stable code/category, a safe
 * pointer, rule/check/case identifiers, and an attempt number -- never the candidate
 * value, schema error `data`/`params`, or raw stdout/stderr that triggered it. Producing
 * these (the evaluation engine, JSON/Markdown renderers) is implemented later; this module
 * only defines the shape everything downstream must agree on.
 */

export type FindingCategory = 'json' | 'schema' | 'invariant' | 'policy' | 'retry' | 'regression';

export interface Finding {
  /** Stable, renderer-independent code, e.g. `"schema.additional-property"`. */
  readonly code: string;
  readonly category: FindingCategory;
  readonly checkId: string;
  readonly caseId: string;
  readonly attempt: number;
  readonly ruleId?: string;
  /** A sanitized RFC 6901 pointer into the candidate document; never the value at it. */
  readonly pointer?: string;
}

/**
 * The exact metric set the plan requires: final/first-pass/retry rates, one pass rate per
 * evaluation stage, and mean attempts. Every metric is an exact integer
 * numerator/denominator pair -- ratios are compared by cross multiplication or fixed
 * decimal parsing elsewhere, never as binary floats.
 */
export const METRIC_IDS = [
  'finalPassRate',
  'firstPassRate',
  'retryRate',
  'jsonPassRate',
  'schemaPassRate',
  'invariantPassRate',
  'policyPassRate',
  'meanAttempts',
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

export interface Metric {
  readonly id: MetricId;
  readonly numerator: number;
  readonly denominator: number;
  /** Exact decimal string; `null` when `denominator` is zero (fail-closed, never NaN/Infinity). */
  readonly value: string | null;
}

export type ThresholdResult = 'pass' | 'fail' | 'insufficient-data';

export interface ThresholdSample {
  readonly numerator: number;
  readonly denominator: number;
  readonly value: string | null;
}

export interface ComparisonThreshold {
  readonly metric: MetricId;
  readonly direction: ThresholdDirection;
  readonly amount?: string;
  readonly current: ThresholdSample;
  readonly baseline: ThresholdSample;
  readonly result: ThresholdResult;
}

export interface ComparisonReport {
  readonly baselineReportPath: string;
  readonly population: 'exact' | 'comparable';
  readonly thresholds: readonly ComparisonThreshold[];
}

export type CheckStatus = 'pass' | 'fail';

export interface CheckReport {
  readonly checkId: string;
  readonly contractId: string;
  readonly status: CheckStatus;
  readonly findings: readonly Finding[];
}

export type ReportStatus = 'pass' | 'fail' | 'error';

export interface AxiomReportV1 {
  readonly reportVersion: 1;
  readonly metricVersion: 1;
  readonly toolVersion: string;
  readonly status: ReportStatus;
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly configFingerprint: string;
  readonly populationFingerprint: string;
  readonly checks: readonly CheckReport[];
  readonly metrics: readonly Metric[];
  readonly comparison?: ComparisonReport;
}
