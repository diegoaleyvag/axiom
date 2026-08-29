import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReportShape, type AxiomReportV1, type Finding } from '@axiom/core';
import { main } from '@axiom/cli';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every scenario fixture in this example is original, fictional community-greenhouse
 * inspection data (see contracts/greenhouse-inspection.schema.json) -- not real-world PII
 * or any employer/exam content. `AXIOM_SYNTHETIC_SECRET_*` markers are synthetic canaries
 * planted only to prove the policy/report pipeline never lets a "secret" value escape.
 */
const SECRET_MARKER_PREFIX = 'AXIOM_SYNTHETIC_SECRET_';

const EXAMPLE_DIR = path.dirname(fileURLToPath(import.meta.url));

let workDir: string;
let configPath: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'greenhouse-example-test-'));
  await cp(EXAMPLE_DIR, workDir, { recursive: true });
  configPath = path.join(workDir, 'axiom.config.yaml');
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(workDir, { recursive: true, force: true });
});

async function readReport(): Promise<{ json: AxiomReportV1; text: string; markdownText: string }> {
  const text = await readFile(path.join(workDir, 'evidence/current.json'), 'utf8');
  const markdownText = await readFile(path.join(workDir, 'evidence/current.md'), 'utf8');
  const json = validateReportShape(JSON.parse(text));
  return { json, text, markdownText };
}

function findingsFor(report: AxiomReportV1, checkId: string, caseId: string): readonly Finding[] {
  const check = report.checks.find((c) => c.checkId === checkId);
  return check ? check.findings.filter((f) => f.caseId === caseId) : [];
}

describe('greenhouse-inspection example: axiom check (scenarios 1-8)', () => {
  it('produces exactly the expected category/code/pointer per scenario, with no secret leakage', async () => {
    const exitCode = await main(['check', '--config', configPath]);
    expect(exitCode).toBe(1);

    const { json: report, text, markdownText } = await readReport();
    expect(report.status).toBe('fail');

    // Scenario 1: valid golden -- no findings at all.
    expect(findingsFor(report, 'greenhouse-primary', 'valid-golden')).toEqual([]);

    // Scenario 2: malformed candidate JSON -> a "json" category finding.
    const malformed = findingsFor(report, 'greenhouse-primary', 'malformed-json');
    expect(malformed).toHaveLength(1);
    expect(malformed[0]).toMatchObject({ category: 'json', code: 'json.invalid-json' });

    // Scenario 3: missing required field -> a "schema" category finding.
    const missingRequired = findingsFor(report, 'greenhouse-primary', 'missing-required-field');
    expect(missingRequired).toHaveLength(1);
    expect(missingRequired[0]).toMatchObject({ category: 'schema', code: 'schema.required' });

    // Scenario 4: enum/type violation -> a "schema" finding pointing at the offending field.
    const enumViolation = findingsFor(report, 'greenhouse-primary', 'enum-type-violation');
    expect(enumViolation).toHaveLength(1);
    expect(enumViolation[0]).toMatchObject({
      category: 'schema',
      code: 'schema.enum',
      pointer: '/observations/0/status',
    });

    // Scenario 5: numeric bound violation -> a "schema" finding pointing at the field.
    const numericViolation = findingsFor(report, 'greenhouse-primary', 'numeric-bound-violation');
    expect(numericViolation).toHaveLength(1);
    expect(numericViolation[0]).toMatchObject({
      category: 'schema',
      code: 'schema.maximum',
      pointer: '/observations/0/confidence',
    });

    // Scenario 6: cross-field count invariant violation -> an "invariant" finding.
    const countViolation = findingsFor(report, 'greenhouse-primary', 'count-invariant-violation');
    expect(countViolation).toHaveLength(1);
    expect(countViolation[0]).toMatchObject({
      category: 'invariant',
      code: 'invariant.failed',
      ruleId: 'total-observations-match',
    });

    // Scenario 7: forbidden field + forbidden pattern leak -> two "policy" findings, neither
    // of which carries the candidate's secret value, only a redaction-aware pointer.
    const forbiddenLeak = findingsFor(report, 'greenhouse-primary', 'forbidden-leak');
    expect(forbiddenLeak).toHaveLength(2);
    expect(forbiddenLeak).toContainEqual(
      expect.objectContaining({
        category: 'policy',
        code: 'policy.forbidden-path',
        ruleId: 'no-internal-notes',
        pointer: '/inspector/internalNotes',
      }),
    );
    expect(forbiddenLeak).toContainEqual(
      expect.objectContaining({
        category: 'policy',
        code: 'policy.forbidden-pattern',
        ruleId: 'no-secret-marker',
      }),
    );

    // Scenario 8: success only after the configured retry limit -- the case ultimately
    // passes (check status "pass"), but the first two attempts' failures are still on record.
    const retryCheck = report.checks.find((c) => c.checkId === 'greenhouse-retry');
    expect(retryCheck?.status).toBe('pass');
    const retryFindings = findingsFor(report, 'greenhouse-retry', 'greenhouse-retry-success');
    expect(retryFindings.map((f) => f.attempt)).toEqual([1, 2]);
    expect(retryFindings[0]).toMatchObject({ category: 'schema' });
    expect(retryFindings[1]).toMatchObject({ category: 'invariant' });

    // No synthetic secret value ever reaches the report, in either rendering.
    expect(text).not.toContain(SECRET_MARKER_PREFIX);
    expect(markdownText).not.toContain(SECRET_MARKER_PREFIX);
  });
});

describe('greenhouse-inspection example: axiom compare (scenario 9)', () => {
  it('detects a same-population baseline regression with exact numerator/denominator evidence', async () => {
    const exitCode = await main(['compare', '--config', configPath]);
    expect(exitCode).toBe(1);

    const { json: report, text, markdownText } = await readReport();
    expect(report.status).toBe('fail');
    expect(report.comparison?.population).toBe('comparable');

    const threshold = report.comparison?.thresholds.find((t) => t.metric === 'finalPassRate');
    expect(threshold).toMatchObject({
      direction: 'max-decrease',
      result: 'fail',
      current: { numerator: 2, denominator: 8 },
      baseline: { numerator: 8, denominator: 8 },
    });

    expect(text).not.toContain(SECRET_MARKER_PREFIX);
    expect(markdownText).not.toContain(SECRET_MARKER_PREFIX);
  });
});

describe('greenhouse-inspection example: committed evidence', () => {
  it('axiom check: matches the committed check-report.json/.md byte-for-byte (full report, not just checks/metrics)', async () => {
    await main(['check', '--config', configPath]);
    const fresh = await readReport();
    const committedText = await readFile(
      path.join(EXAMPLE_DIR, 'evidence/check-report.json'),
      'utf8',
    );
    const committedMarkdown = await readFile(
      path.join(EXAMPLE_DIR, 'evidence/check-report.md'),
      'utf8',
    );
    // Full-document byte equality (not a field-by-field `toEqual`): this is the actual
    // regeneration contract `scripts/verify-example-evidence.mjs` enforces in CI, and it
    // additionally proves configFingerprint/populationFingerprint round-trip identically.
    expect(fresh.text).toBe(committedText);
    expect(fresh.markdownText).toBe(committedMarkdown);
    validateReportShape(JSON.parse(committedText));
  });

  it('axiom compare: matches the committed compare-report.json/.md byte-for-byte, including a config-relative (not absolute) baselineReportPath', async () => {
    await main(['compare', '--config', configPath]);
    const fresh = await readReport();
    const committedText = await readFile(
      path.join(EXAMPLE_DIR, 'evidence/compare-report.json'),
      'utf8',
    );
    const committedMarkdown = await readFile(
      path.join(EXAMPLE_DIR, 'evidence/compare-report.md'),
      'utf8',
    );
    expect(fresh.text).toBe(committedText);
    expect(fresh.markdownText).toBe(committedMarkdown);

    const committed = validateReportShape(JSON.parse(committedText));
    // Regression guard: this field must never be an absolute filesystem path (which would
    // make the evidence non-reproducible across machines/checkouts) -- see
    // `CompiledBaseline.reportPathRelative`'s doc comment in `@axiom/core`.
    expect(committed.comparison?.baselineReportPath).toBe('baseline/baseline-report.json');
    expect(path.isAbsolute(committed.comparison?.baselineReportPath ?? '')).toBe(false);
  });
});
