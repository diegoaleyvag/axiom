import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAjv } from '../schema/ajv-factory.js';

const LIMITS = { maxPatternLength: 512 };

function readSchema(name: string): unknown {
  const url = new URL(`../../../../schemas/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

describe('bundled versioned schemas', () => {
  it('axiom-artifact.v1.schema.json compiles under strict Ajv and accepts a valid envelope', () => {
    const ajv = createAjv(LIMITS);
    const validate = ajv.compile(readSchema('axiom-artifact.v1.schema.json'));
    expect(
      validate({
        artifactVersion: 1,
        caseId: 'sample-001',
        attempts: [{ content: '{"malformed": true' }, { content: '{"ok": true}' }],
      }),
    ).toBe(true);
  });

  it('axiom-artifact.v1.schema.json rejects an unversioned or malformed envelope', () => {
    const ajv = createAjv(LIMITS);
    const validate = ajv.compile(readSchema('axiom-artifact.v1.schema.json'));
    expect(validate({ artifactVersion: 2, caseId: 'x', attempts: [{ content: 'a' }] })).toBe(false);
    expect(validate({ artifactVersion: 1, caseId: 'x', attempts: [] })).toBe(false);
    expect(validate({ artifactVersion: 1, caseId: 'x', attempts: [{ content: 42 }] })).toBe(false);
  });

  it('axiom-report.v1.schema.json compiles under strict Ajv and accepts a value-free report', () => {
    const ajv = createAjv(LIMITS);
    const validate = ajv.compile(readSchema('axiom-report.v1.schema.json'));
    const report = {
      reportVersion: 1,
      metricVersion: 1,
      toolVersion: '0.1.0',
      status: 'fail',
      exitCode: 1,
      configFingerprint: 'sha256:abc',
      populationFingerprint: 'sha256:def',
      checks: [
        {
          checkId: 'extraction-fixture',
          contractId: 'extraction',
          status: 'fail',
          findings: [
            {
              code: 'schema.additional-property',
              category: 'schema',
              checkId: 'extraction-fixture',
              caseId: 'canonical',
              attempt: 1,
              pointer: '/items/0/debug',
            },
          ],
        },
      ],
      metrics: [{ id: 'finalPassRate', numerator: 0, denominator: 1, value: '0' }],
    };
    expect(validate(report)).toBe(true);
  });

  it('axiom-report.v1.schema.json rejects a finding carrying an unknown category', () => {
    const ajv = createAjv(LIMITS);
    const validate = ajv.compile(readSchema('axiom-report.v1.schema.json'));
    expect(
      validate({
        reportVersion: 1,
        metricVersion: 1,
        toolVersion: '0.1.0',
        status: 'fail',
        exitCode: 1,
        configFingerprint: 'x',
        populationFingerprint: 'x',
        checks: [
          {
            checkId: 'c',
            contractId: 'c',
            status: 'fail',
            findings: [
              { code: 'x', category: 'not-a-real-category', checkId: 'c', caseId: 'c', attempt: 1 },
            ],
          },
        ],
        metrics: [],
      }),
    ).toBe(false);
  });

  it('axiom-config.v1.schema.json itself compiles under strict Ajv', () => {
    const ajv = createAjv(LIMITS);
    expect(() => ajv.compile(readSchema('axiom-config.v1.schema.json'))).not.toThrow();
  });
});
