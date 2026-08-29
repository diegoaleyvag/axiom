import { describe, expect, it } from 'vitest';
import type { CompiledCheck, CompiledContract } from '../domain/compiled-config.js';
import { runCheck } from './run-check.js';
import { createSchemaValidatorCache } from './schema-cache.js';
import { createInMemoryFileSystem } from './test-support/fake-fs.js';
import { createScriptedProcess, ok } from './test-support/fake-process.js';

const SCHEMA_PATH = '/root/contracts/example.schema.json';
const STRICT_SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['count'],
  properties: { count: { type: 'integer' } },
});
const NO_REDACTION = { pathSegments: [] };

function contract(): CompiledContract {
  return {
    id: 'example',
    schemaRootPath: SCHEMA_PATH,
    schemaResourcePaths: [],
    invariants: [],
    forbiddenPaths: [],
    forbiddenPatterns: [],
  };
}

/**
 * Regression coverage for the "spurious single-attempt retry.exhausted" cross-review
 * finding: a `retry.exhausted` finding must only ever appear when a case was actually
 * *eligible* for more than one attempt -- never merely because the check's *configured*
 * `retries.maxAttempts` happens to be greater than 1 while this particular case only ever
 * had one attempt on offer (an artifact item recording a single attempt, or a
 * single-attempt command-source check).
 */
describe('runCheck: "retry.exhausted" is scoped to cases actually eligible for a retry', () => {
  it('does NOT emit retry.exhausted for a failing artifact case with only one recorded attempt, even when the check allows more', async () => {
    const check: CompiledCheck = {
      id: 'check-1',
      contractId: 'example',
      source: {
        kind: 'artifacts',
        items: [{ id: 'single-attempt-case', path: '/root/case.json', format: 'raw' }],
      },
      retries: { maxAttempts: 3, delayMs: 0 },
    };
    const fs = createInMemoryFileSystem({
      [SCHEMA_PATH]: STRICT_SCHEMA,
      '/root/case.json': '{"count":"not-a-number"}',
    });

    const { checkReport } = await runCheck(
      fs,
      createScriptedProcess([]).port,
      createSchemaValidatorCache(),
      check,
      contract(),
      NO_REDACTION,
    );

    expect(checkReport.status).toBe('fail');
    const codes = checkReport.findings.map((f) => f.code);
    expect(codes).not.toContain('retry.exhausted');
    expect(codes).toEqual(['schema.type']);
  });

  it('DOES emit retry.exhausted for a failing multi-attempt artifact case that exhausts every attempt', async () => {
    const check: CompiledCheck = {
      id: 'check-1',
      contractId: 'example',
      source: {
        kind: 'artifacts',
        items: [{ id: 'multi-attempt-case', path: '/root/case.json', format: 'envelope' }],
      },
      retries: { maxAttempts: 3, delayMs: 0 },
    };
    const envelope = JSON.stringify({
      artifactVersion: 1,
      caseId: 'multi-attempt-case',
      attempts: [
        { content: '{"count":"a"}' },
        { content: '{"count":"b"}' },
        { content: '{"count":"c"}' },
      ],
    });
    const fs = createInMemoryFileSystem({
      [SCHEMA_PATH]: STRICT_SCHEMA,
      '/root/case.json': envelope,
    });

    const { checkReport } = await runCheck(
      fs,
      createScriptedProcess([]).port,
      createSchemaValidatorCache(),
      check,
      contract(),
      NO_REDACTION,
    );

    expect(checkReport.status).toBe('fail');
    const retryFindings = checkReport.findings.filter((f) => f.code === 'retry.exhausted');
    expect(retryFindings).toHaveLength(1);
    expect(retryFindings[0]).toMatchObject({ caseId: 'multi-attempt-case', attempt: 3 });
  });

  it('does NOT emit retry.exhausted for a single-attempt (maxAttempts: 1) command-source check', async () => {
    const fs = createInMemoryFileSystem({ [SCHEMA_PATH]: STRICT_SCHEMA });
    const check: CompiledCheck = {
      id: 'check-1',
      contractId: 'example',
      source: {
        kind: 'command',
        executable: 'fake-tool',
        args: [],
        cwd: '/work',
        timeoutMs: 5000,
        maxStdoutBytes: 1024,
        maxStderrBytes: 1024,
        env: [],
      },
      retries: { maxAttempts: 1, delayMs: 0 },
    };
    const { port } = createScriptedProcess([ok('{"count":"nope"}')]);

    const { checkReport } = await runCheck(
      fs,
      port,
      createSchemaValidatorCache(),
      check,
      contract(),
      NO_REDACTION,
    );

    expect(checkReport.status).toBe('fail');
    expect(checkReport.findings.map((f) => f.code)).toEqual(['schema.type']);
  });

  it('DOES emit retry.exhausted for a multi-attempt command-source check that never passes', async () => {
    const fs = createInMemoryFileSystem({ [SCHEMA_PATH]: STRICT_SCHEMA });
    const check: CompiledCheck = {
      id: 'check-1',
      contractId: 'example',
      source: {
        kind: 'command',
        executable: 'fake-tool',
        args: [],
        cwd: '/work',
        timeoutMs: 5000,
        maxStdoutBytes: 1024,
        maxStderrBytes: 1024,
        env: [],
      },
      retries: { maxAttempts: 2, delayMs: 0 },
    };
    const { port } = createScriptedProcess([ok('{"count":"a"}'), ok('{"count":"b"}')]);

    const { checkReport } = await runCheck(
      fs,
      port,
      createSchemaValidatorCache(),
      check,
      contract(),
      NO_REDACTION,
    );

    expect(checkReport.status).toBe('fail');
    const retryFindings = checkReport.findings.filter((f) => f.code === 'retry.exhausted');
    expect(retryFindings).toHaveLength(1);
    expect(retryFindings[0]).toMatchObject({ caseId: 'check-1', attempt: 2 });
  });
});
