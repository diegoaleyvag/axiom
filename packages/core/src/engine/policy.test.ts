import { describe, expect, it } from 'vitest';
import type { CompiledContract } from '../domain/compiled-config.js';
import { compileBoundedPattern } from '../schema/regex-engine.js';
import { evaluateForbidden } from './policy.js';

const NO_REDACTION = { pathSegments: [] };

function contract(overrides: Partial<CompiledContract> = {}): CompiledContract {
  return {
    id: 'example',
    schemaRootPath: '/unused.json',
    schemaResourcePaths: [],
    invariants: [],
    forbiddenPaths: [],
    forbiddenPatterns: [],
    ...overrides,
  };
}

describe('evaluateForbidden', () => {
  it('flags a present forbidden path with a stable ruleId and pointer', () => {
    const c = contract({
      forbiddenPaths: [{ id: 'no-secret', segments: [{ kind: 'exact', key: 'secret' }] }],
    });
    const findings = evaluateForbidden(c, { secret: 'x' }, NO_REDACTION);
    expect(findings).toEqual([
      {
        code: 'policy.forbidden-path',
        category: 'policy',
        ruleId: 'no-secret',
        pointer: '/secret',
      },
    ]);
  });

  it('flags a forbidden stringValues pattern match', () => {
    const c = contract({
      forbiddenPatterns: [
        {
          id: 'no-marker',
          segments: [{ kind: 'exact', key: 'note' }],
          target: 'stringValues',
          matcher: compileBoundedPattern('SECRET', '', { maxPatternLength: 256 }),
        },
      ],
    });
    const findings = evaluateForbidden(c, { note: 'contains SECRET here' }, NO_REDACTION);
    expect(findings).toEqual([
      {
        code: 'policy.forbidden-pattern',
        category: 'policy',
        ruleId: 'no-marker',
        pointer: '/note',
      },
    ]);
  });

  describe('forbidden-pattern-key: raw candidate keys are bounded before entering a report pointer', () => {
    it('includes a normal-length matching key verbatim in the pointer', () => {
      const c = contract({
        forbiddenPatterns: [
          {
            id: 'no-token-key',
            segments: [{ kind: 'exact', key: 'headers' }],
            target: 'keys',
            matcher: compileBoundedPattern('^x-token$', '', { maxPatternLength: 256 }),
          },
        ],
      });
      const findings = evaluateForbidden(c, { headers: { 'x-token': 'v' } }, NO_REDACTION);
      expect(findings).toEqual([
        {
          code: 'policy.forbidden-pattern-key',
          category: 'policy',
          ruleId: 'no-token-key',
          pointer: '/headers/x-token',
        },
      ]);
    });

    it('truncates a pathologically long candidate key instead of embedding it verbatim in the report', () => {
      const hugeKey = `x-token-${'a'.repeat(10_000)}`;
      const c = contract({
        forbiddenPatterns: [
          {
            id: 'no-token-key',
            segments: [{ kind: 'exact', key: 'headers' }],
            target: 'keys',
            matcher: compileBoundedPattern('^x-token-', '', { maxPatternLength: 256 }),
          },
        ],
      });
      const findings = evaluateForbidden(c, { headers: { [hugeKey]: 'v' } }, NO_REDACTION);

      expect(findings).toHaveLength(1);
      const pointer = findings[0]?.pointer as string;
      // The full 10,000+ character candidate key must never reach the report verbatim.
      expect(pointer.length).toBeLessThan(400);
      expect(pointer).toContain('\u2026'); // the truncation marker
      expect(pointer.startsWith('/headers/x-token-')).toBe(true);
    });

    it('redacts the pointer (including the candidate key segment) when it matches a configured redaction path', () => {
      const c = contract({
        forbiddenPatterns: [
          {
            id: 'no-token-key',
            segments: [{ kind: 'exact', key: 'headers' }],
            target: 'keys',
            matcher: compileBoundedPattern('^x-token$', '', { maxPatternLength: 256 }),
          },
        ],
      });
      const redaction = {
        pathSegments: [[{ kind: 'exact' as const, key: 'headers' }, { kind: 'wildcard' as const }]],
      };
      const findings = evaluateForbidden(c, { headers: { 'x-token': 'v' } }, redaction);
      expect(findings[0]?.pointer).toBe('[redacted]');
    });
  });

  it('caps recorded findings per rule at the configured maximum', () => {
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`key-${i}`, 'v']));
    const c = contract({
      forbiddenPatterns: [
        {
          id: 'no-key',
          segments: [{ kind: 'exact', key: 'obj' }],
          target: 'keys',
          matcher: compileBoundedPattern('^key-', '', { maxPatternLength: 256 }),
        },
      ],
    });
    const findings = evaluateForbidden(c, { obj: many }, NO_REDACTION);
    expect(findings.length).toBeLessThanOrEqual(20);
  });
});
