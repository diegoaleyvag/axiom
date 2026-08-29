import type {
  AxiomReportV1,
  CheckReport,
  ComparisonReport,
  Metric,
  ReportStatus,
} from '../domain/report.js';
import { BoundsError } from '../errors.js';
import { EXIT_CODES, type ExitCode } from '../exit-code.js';
import { DEFAULT_LIMITS } from '../limits.js';
import { CORE_VERSION } from '../version.js';

export interface BuildReportOptions {
  readonly configFingerprint: string;
  readonly populationFingerprint: string;
  readonly checks: readonly CheckReport[];
  readonly metrics: readonly Metric[];
  readonly comparison?: ComparisonReport;
}

/**
 * Assembles the canonical {@link AxiomReportV1} and decides the run's overall status/exit
 * code, the single place that decision is made (both `axiom check` and `axiom compare` call
 * this rather than each computing their own status logic):
 *
 * - `"fail"` (exit `1`) if any check failed, or any comparison threshold resolved to `"fail"`.
 * - `"error"` (exit `1`) if nothing failed but a comparison threshold resolved to
 *   `"insufficient-data"` -- not enough evidence to call it a pass, but not a concrete
 *   contract violation either. Still exit `1`: this is a quality/evidentiary outcome the
 *   evaluator decided, never a thrown exception, so it must not collide with exit `2`/`3`.
 * - `"pass"` (exit `0`) otherwise.
 *
 * Throws {@link BoundsError} if the total finding count across every check would exceed
 * `DEFAULT_LIMITS.maxFindings` -- a hard cap that fails the run rather than silently
 * truncating evidence.
 */
export function buildReport(options: BuildReportOptions): AxiomReportV1 {
  const totalFindings = options.checks.reduce((sum, check) => sum + check.findings.length, 0);
  if (totalFindings > DEFAULT_LIMITS.maxFindings) {
    throw new BoundsError(
      'bounds.max-findings-exceeded',
      `This run produced ${totalFindings} findings, exceeding the ${DEFAULT_LIMITS.maxFindings} limit.`,
    );
  }

  const anyCheckFailed = options.checks.some((check) => check.status === 'fail');
  const anyThresholdFailed =
    options.comparison?.thresholds.some((t) => t.result === 'fail') ?? false;
  const anyInsufficientData =
    options.comparison?.thresholds.some((t) => t.result === 'insufficient-data') ?? false;

  let status: ReportStatus;
  if (anyCheckFailed || anyThresholdFailed) {
    status = 'fail';
  } else if (anyInsufficientData) {
    status = 'error';
  } else {
    status = 'pass';
  }

  const exitCode: ExitCode = status === 'pass' ? EXIT_CODES.SUCCESS : EXIT_CODES.CONTRACT_FAILURE;

  return {
    reportVersion: 1,
    metricVersion: 1,
    toolVersion: CORE_VERSION,
    status,
    exitCode,
    configFingerprint: options.configFingerprint,
    populationFingerprint: options.populationFingerprint,
    checks: options.checks,
    metrics: options.metrics,
    ...(options.comparison ? { comparison: options.comparison } : {}),
  };
}
