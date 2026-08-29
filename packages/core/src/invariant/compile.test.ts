import { describe, expect, it } from 'vitest';
import { BoundsError, ConfigError } from '../errors.js';
import type { CompileExprLimits } from './compile.js';
import { compileExpr } from './compile.js';

const LIMITS: CompileExprLimits = {
  maxSegments: 32,
  maxSegmentLength: 128,
  maxWildcards: 8,
  maxDepth: 16,
  maxNodes: 200,
  maxOperands: 16,
};

describe('compileExpr', () => {
  it('compiles a literal', () => {
    expect(compileExpr({ kind: 'literal', value: 42 }, LIMITS)).toEqual({
      kind: 'literal',
      value: 42,
    });
  });

  it('compiles a path into parsed pointer segments', () => {
    expect(compileExpr({ kind: 'path', pointer: '/a/b' }, LIMITS)).toEqual({
      kind: 'path',
      segments: ['a', 'b'],
    });
  });

  it('compiles a select into parsed selector segments', () => {
    expect(compileExpr({ kind: 'select', selector: '/a/*' }, LIMITS)).toEqual({
      kind: 'select',
      segments: [{ kind: 'exact', key: 'a' }, { kind: 'wildcard' }],
    });
  });

  it('compiles count/eq/exists/isType/not/if/all/any composites', () => {
    const expr = {
      kind: 'if',
      condition: { kind: 'exists', target: { kind: 'path', pointer: '/x' } },
      then: {
        kind: 'eq',
        left: { kind: 'count', of: { kind: 'select', selector: '/items/*' } },
        right: { kind: 'literal', value: 3 },
      },
      else: {
        kind: 'all',
        operands: [
          { kind: 'not', operand: { kind: 'literal', value: false } },
          { kind: 'isType', target: { kind: 'path', pointer: '/y' }, type: 'string' },
        ],
      },
    };
    expect(() => compileExpr(expr, LIMITS)).not.toThrow();
  });

  it('compiles subset/contains', () => {
    const expr = {
      kind: 'subset',
      left: { kind: 'select', selector: '/a/*' },
      right: { kind: 'select', selector: '/b/*' },
    };
    expect(() => compileExpr(expr, LIMITS)).not.toThrow();
    const containsExpr = {
      kind: 'contains',
      collection: { kind: 'select', selector: '/a/*' },
      value: { kind: 'literal', value: 1 },
    };
    expect(() => compileExpr(containsExpr, LIMITS)).not.toThrow();
  });

  it('rejects a non-object node', () => {
    expect(() => compileExpr('not-an-object', LIMITS)).toThrow(ConfigError);
    expect(() => compileExpr(null, LIMITS)).toThrow(ConfigError);
    expect(() => compileExpr([1, 2], LIMITS)).toThrow(ConfigError);
  });

  it('rejects an unknown "kind"', () => {
    expect(() => compileExpr({ kind: 'eval', code: '1+1' }, LIMITS)).toThrow(ConfigError);
  });

  it('rejects an unknown JSON type in isType', () => {
    expect(() =>
      compileExpr(
        { kind: 'isType', target: { kind: 'path', pointer: '/x' }, type: 'function' },
        LIMITS,
      ),
    ).toThrow(ConfigError);
  });

  it('rejects a missing required field', () => {
    expect(() => compileExpr({ kind: 'eq', left: { kind: 'literal', value: 1 } }, LIMITS)).toThrow(
      ConfigError,
    );
  });

  it('rejects an expression deeper than maxDepth', () => {
    let expr: unknown = { kind: 'literal', value: 1 };
    for (let i = 0; i < 20; i += 1) {
      expr = { kind: 'not', operand: expr };
    }
    expect(() => compileExpr(expr, { ...LIMITS, maxDepth: 5 })).toThrow(BoundsError);
  });

  it('rejects an expression with more nodes than maxNodes', () => {
    const operands = Array.from({ length: 50 }, (_, i) => ({ kind: 'literal', value: i }));
    expect(() => compileExpr({ kind: 'any', operands }, { ...LIMITS, maxNodes: 10 })).toThrow(
      BoundsError,
    );
  });

  it('rejects an "all"/"any" operand list longer than maxOperands', () => {
    const operands = Array.from({ length: 20 }, (_, i) => ({ kind: 'literal', value: i }));
    expect(() => compileExpr({ kind: 'all', operands }, { ...LIMITS, maxOperands: 5 })).toThrow(
      BoundsError,
    );
  });

  it('has no eval/JavaScript/template escape hatch: unknown kinds always fail closed', () => {
    for (const dangerous of ['eval', 'function', 'template', 'jsonpath', '$where']) {
      expect(() => compileExpr({ kind: dangerous, expression: '1' }, LIMITS)).toThrow(ConfigError);
    }
  });
});
