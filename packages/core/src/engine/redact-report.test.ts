import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AxiomReportV1 } from '../domain/report.js';
import { compileRedactionPattern } from '../redaction/patterns.js';
import { REDACTED_VALUE_PLACEHOLDER } from '../redaction/redact.js';
import { redactReportDefensively } from './redact-report.js';
import { validateReportShape } from './validate-report.js';

const PATTERN_LIMITS = { maxPatternLength: 256 };

function reportWithRuleId(ruleId: string, code = 'invariant.failed'): AxiomReportV1 {
  return {
    reportVersion: 1,
    metricVersion: 1,
    toolVersion: '0.1.0',
    status: 'fail',
    exitCode: 1,
    configFingerprint: 'cfg',
    populationFingerprint: 'pop',
    checks: [
      {
        checkId: 'check-1',
        contractId: 'contract-1',
        status: 'fail',
        findings: [
          { code, category: 'invariant', checkId: 'check-1', caseId: 'case-1', attempt: 1, ruleId },
        ],
      },
    ],
    metrics: [],
  };
}

/**
 * Regression coverage for the "keep defensive redaction schema-valid for ruleId
 * round-trips" cross-review finding: `redactReportDefensively` must never produce a
 * `ruleId` that fails `schemas/axiom-report.v1.schema.json`'s `$defs.id` pattern
 * (`^[A-Za-z][A-Za-z0-9_-]{0,63}$`), which forbids the `[`/`]` characters in
 * `REDACTED_VALUE_PLACEHOLDER`.
 */
describe('redactReportDefensively: ruleId stays schema-valid after redaction', () => {
  it('replaces a matching ruleId with an id-shaped placeholder, not the bracketed value placeholder', () => {
    const patterns = [compileRedactionPattern('secret-[0-9]+', [], PATTERN_LIMITS)];
    const report = reportWithRuleId('rule-secret-42-check');

    const redacted = redactReportDefensively(report, patterns);
    const ruleId = redacted.checks[0]?.findings[0]?.ruleId;

    expect(ruleId).not.toContain('[');
    expect(ruleId).not.toContain(']');
    expect(ruleId).not.toBe(REDACTED_VALUE_PLACEHOLDER);
    // Must still validate against the real report schema: this is the actual regression
    // this finding was about, not just an absence of bracket characters.
    expect(() => validateReportShape(redacted as unknown as never)).not.toThrow();
  });

  it('leaves a non-matching ruleId completely untouched', () => {
    const patterns = [compileRedactionPattern('secret-[0-9]+', [], PATTERN_LIMITS)];
    const report = reportWithRuleId('totally-unrelated-rule');

    const redacted = redactReportDefensively(report, patterns);
    expect(redacted.checks[0]?.findings[0]?.ruleId).toBe('totally-unrelated-rule');
  });

  it('still uses the bracketed placeholder for "code" and "pointer" (no id-pattern constraint there)', () => {
    const patterns = [compileRedactionPattern('secret-[0-9]+', [], PATTERN_LIMITS)];
    const report: AxiomReportV1 = {
      ...reportWithRuleId('unrelated-rule', 'schema.secret-42'),
    };
    const withPointer: AxiomReportV1 = {
      ...report,
      checks: [
        {
          ...report.checks[0]!,
          findings: [{ ...report.checks[0]!.findings[0]!, pointer: '/notes/secret-42' }],
        },
      ],
    };

    const redacted = redactReportDefensively(withPointer, patterns);
    const finding = redacted.checks[0]?.findings[0];
    expect(finding?.code).toContain(REDACTED_VALUE_PLACEHOLDER);
    expect(finding?.pointer).toContain(REDACTED_VALUE_PLACEHOLDER);
  });

  it('property: for any ruleId and any matching pattern, the redacted ruleId always satisfies the report schema id pattern', () => {
    const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,20}$/),
        fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,20}$/),
        (ruleId, patternFragment) => {
          const patterns = [compileRedactionPattern(patternFragment, [], PATTERN_LIMITS)];
          const report = reportWithRuleId(ruleId);
          const redacted = redactReportDefensively(report, patterns);
          const resultingRuleId = redacted.checks[0]?.findings[0]?.ruleId as string;
          expect(ID_PATTERN.test(resultingRuleId)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
