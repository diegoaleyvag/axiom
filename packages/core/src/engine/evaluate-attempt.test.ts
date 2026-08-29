import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CompiledContract } from '../domain/compiled-config.js';
import { compileBoundedPattern } from '../schema/regex-engine.js';
import { evaluateAttempt } from './evaluate-attempt.js';
import { createSchemaValidatorCache } from './schema-cache.js';
import { createInMemoryFileSystem } from './test-support/fake-fs.js';

const SCHEMA_PATH = '/root/contracts/example.schema.json';

const STRICT_SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['count', 'items'],
  properties: {
    count: { type: 'integer' },
    items: { type: 'array', items: { type: 'string' } },
  },
});

const PERMISSIVE_SCHEMA = JSON.stringify({ type: 'object' });

function makeContract(overrides: Partial<CompiledContract> = {}): CompiledContract {
  return {
    id: 'example',
    schemaRootPath: SCHEMA_PATH,
    schemaResourcePaths: [],
    invariants: [],
    forbiddenPaths: [],
    forbiddenPatterns: [],
    ...overrides,
  };
}

const NO_REDACTION = { pathSegments: [] };

describe('evaluateAttempt', () => {
  it('passes a schema-valid, invariant-satisfying, policy-clean attempt', async () => {
    const fs = createInMemoryFileSystem({ [SCHEMA_PATH]: STRICT_SCHEMA });
    const result = await evaluateAttempt(
      fs,
      createSchemaValidatorCache(),
      makeContract(),
      NO_REDACTION,
      JSON.stringify({ count: 2, items: ['a', 'b'] }),
    );
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('produces a json finding (never a thrown error) for malformed candidate content', async () => {
    const fs = createInMemoryFileSystem({ [SCHEMA_PATH]: STRICT_SCHEMA });
    const result = await evaluateAttempt(
      fs,
      createSchemaValidatorCache(),
      makeContract(),
      NO_REDACTION,
      '{not valid json',
    );
    expect(result.passed).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.category).toBe('json');
  });

  it('produces a schema finding with a safe pointer for a schema violation', async () => {
    const fs = createInMemoryFileSystem({ [SCHEMA_PATH]: STRICT_SCHEMA });
    const result = await evaluateAttempt(
      fs,
      createSchemaValidatorCache(),
      makeContract(),
      NO_REDACTION,
      JSON.stringify({ count: 'not-a-number', items: [] }),
    );
    expect(result.passed).toBe(false);
    expect(result.findings[0]?.category).toBe('schema');
    expect(result.findings[0]?.pointer).toBe('/count');
  });

  it('redacts a schema finding pointer that matches a configured redaction path', async () => {
    const fs = createInMemoryFileSystem({ [SCHEMA_PATH]: STRICT_SCHEMA });
    const redaction = { pathSegments: [[{ kind: 'exact' as const, key: 'count' }]] };
    const result = await evaluateAttempt(
      fs,
      createSchemaValidatorCache(),
      makeContract(),
      redaction,
      JSON.stringify({ count: 'x', items: [] }),
    );
    expect(result.findings[0]?.pointer).toBe('[redacted]');
  });

  it('evaluates invariants after a schema pass, and stops before policy on failure', async () => {
    const fs = createInMemoryFileSystem({ [SCHEMA_PATH]: STRICT_SCHEMA });
    const contract = makeContract({
      invariants: [
        {
          id: 'count-matches',
          assert: {
            kind: 'eq',
            left: { kind: 'path', segments: ['count'] },
            right: {
              kind: 'count',
              of: {
                kind: 'select',
                segments: [{ kind: 'exact', key: 'items' }, { kind: 'wildcard' }],
              },
            },
          },
        },
      ],
    });
    const result = await evaluateAttempt(
      fs,
      createSchemaValidatorCache(),
      contract,
      NO_REDACTION,
      JSON.stringify({ count: 5, items: ['a'] }),
    );
    expect(result.passed).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.category).toBe('invariant');
    expect(result.findings[0]?.ruleId).toBe('count-matches');
  });

  it('evaluates forbidden-path policy once json/schema/invariant all pass', async () => {
    const fs = createInMemoryFileSystem({ [SCHEMA_PATH]: PERMISSIVE_SCHEMA });
    const contract = makeContract({
      forbiddenPaths: [{ id: 'no-secret', segments: [{ kind: 'exact', key: 'secret' }] }],
    });
    const result = await evaluateAttempt(
      fs,
      createSchemaValidatorCache(),
      contract,
      NO_REDACTION,
      JSON.stringify({ secret: 'leaked' }),
    );
    expect(result.passed).toBe(false);
    expect(result.findings[0]?.code).toBe('policy.forbidden-path');
    expect(result.findings[0]?.ruleId).toBe('no-secret');
  });

  it('evaluates forbidden-pattern policy against string values at the selected location', async () => {
    const fs = createInMemoryFileSystem({ [SCHEMA_PATH]: PERMISSIVE_SCHEMA });
    const contract = makeContract({
      forbiddenPatterns: [
        {
          id: 'no-private-key',
          segments: [{ kind: 'exact', key: 'notes' }],
          target: 'stringValues',
          matcher: compileBoundedPattern('BEGIN PRIVATE KEY', '', { maxPatternLength: 256 }),
        },
      ],
    });
    const clean = await evaluateAttempt(
      fs,
      createSchemaValidatorCache(),
      contract,
      NO_REDACTION,
      JSON.stringify({ notes: 'nothing to see here' }),
    );
    expect(clean.passed).toBe(true);

    const dirty = await evaluateAttempt(
      fs,
      createSchemaValidatorCache(),
      contract,
      NO_REDACTION,
      JSON.stringify({ notes: '-----BEGIN PRIVATE KEY-----' }),
    );
    expect(dirty.passed).toBe(false);
    expect(dirty.findings[0]?.code).toBe('policy.forbidden-pattern');
  });
});

describe('evaluateAttempt: property (totality and determinism)', () => {
  // A single non-trivial contract exercising every stage (schema, invariant, forbidden path,
  // forbidden pattern), reused across every generated candidate below.
  const fullContract = makeContract({
    invariants: [
      {
        id: 'count-matches',
        assert: {
          kind: 'eq',
          left: { kind: 'path', segments: ['count'] },
          right: {
            kind: 'count',
            of: {
              kind: 'select',
              segments: [{ kind: 'exact', key: 'items' }, { kind: 'wildcard' }],
            },
          },
        },
      },
    ],
    forbiddenPaths: [{ id: 'no-secret', segments: [{ kind: 'exact', key: 'secret' }] }],
    forbiddenPatterns: [
      {
        id: 'no-marker',
        segments: [{ kind: 'exact', key: 'items' }, { kind: 'wildcard' }],
        target: 'stringValues',
        matcher: compileBoundedPattern('FORBIDDEN', '', { maxPatternLength: 256 }),
      },
    ],
  });

  // A mix of: raw fuzzed strings (exercising the json-parse-failure path), arbitrary JSON
  // values re-serialized (exercising the schema/invariant/policy paths), and a few
  // hand-picked near-misses that dance around the schema/invariant/policy boundaries.
  const candidateArb = fc.oneof(
    fc.string({ maxLength: 300 }),
    fc.jsonValue({ maxDepth: 4 }).map((value) => JSON.stringify(value)),
    fc
      .record({
        count: fc.oneof(fc.integer({ min: -5, max: 5 }), fc.string({ maxLength: 5 })),
        items: fc.array(fc.oneof(fc.string({ maxLength: 10 }), fc.constant('FORBIDDEN-marker')), {
          maxLength: 5,
        }),
        secret: fc.option(fc.string({ maxLength: 5 }), { nil: undefined }),
      })
      .map((value) => JSON.stringify(value)),
  );

  it('never throws for any bounded string content, and is fully deterministic on repeat evaluation', async () => {
    await fc.assert(
      fc.asyncProperty(candidateArb, async (content) => {
        const fs = createInMemoryFileSystem({ [SCHEMA_PATH]: STRICT_SCHEMA });
        const cache = createSchemaValidatorCache();
        const NO_REDACTION = { pathSegments: [] };

        const first = await evaluateAttempt(fs, cache, fullContract, NO_REDACTION, content);
        const second = await evaluateAttempt(fs, cache, fullContract, NO_REDACTION, content);

        expect(second).toEqual(first);
        expect(first.passed).toBe(first.findings.length === 0);
        // Every finding carries a stable code/category and never the candidate content itself.
        for (const finding of first.findings) {
          expect(typeof finding.code).toBe('string');
          expect(['json', 'schema', 'invariant', 'policy']).toContain(finding.category);
          expect(JSON.stringify(finding)).not.toContain('FORBIDDEN-marker');
        }
      }),
      { numRuns: 500 },
    );
  });
});
