import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../domain/json.js';
import type { Expr } from '../invariant/ast.js';
import { evaluateInvariant } from './invariant-eval.js';

const path = (...segments: string[]): Expr => ({ kind: 'path', segments });
const literal = (value: JsonValue): Expr => ({ kind: 'literal', value });
const select = (...segments: Array<string | '*'>): Expr => ({
  kind: 'select',
  segments: segments.map((segment) =>
    segment === '*' ? { kind: 'wildcard' } : { kind: 'exact', key: segment },
  ),
});

describe('evaluateInvariant', () => {
  const document: JsonValue = {
    summary: { count: 2 },
    items: [{ id: 'a' }, { id: 'b' }],
    status: 'ok',
  };

  it('eq: true for structurally equal values', () => {
    expect(
      evaluateInvariant({ kind: 'eq', left: path('status'), right: literal('ok') }, document),
    ).toBe(true);
  });

  it('eq: false, not throwing, when one side is MISSING', () => {
    expect(
      evaluateInvariant({ kind: 'eq', left: path('nope'), right: literal(null) }, document),
    ).toBe(false);
  });

  it('ne: true when one side is MISSING (fails closed to "not equal", not an error)', () => {
    expect(
      evaluateInvariant({ kind: 'ne', left: path('nope'), right: literal('ok') }, document),
    ).toBe(true);
  });

  it('count via select matches an explicit count field', () => {
    expect(
      evaluateInvariant(
        {
          kind: 'eq',
          left: path('summary', 'count'),
          right: { kind: 'count', of: select('items', '*') },
        },
        document,
      ),
    ).toBe(true);
  });

  it('count of MISSING is zero', () => {
    expect(
      evaluateInvariant(
        { kind: 'eq', left: { kind: 'count', of: path('nope') }, right: literal(0) },
        document,
      ),
    ).toBe(true);
  });

  it('exists: true for a present null, false for MISSING', () => {
    const withNull: JsonValue = { field: null };
    expect(evaluateInvariant({ kind: 'exists', target: path('field') }, withNull)).toBe(true);
    expect(evaluateInvariant({ kind: 'exists', target: path('nope') }, withNull)).toBe(false);
  });

  it('isType: false for MISSING regardless of the requested type', () => {
    expect(
      evaluateInvariant({ kind: 'isType', target: path('nope'), type: 'null' }, document),
    ).toBe(false);
  });

  it('lt/lte/gt/gte: false whenever either operand is not a number', () => {
    expect(evaluateInvariant({ kind: 'lt', left: literal('a'), right: literal(1) }, document)).toBe(
      false,
    );
    expect(
      evaluateInvariant({ kind: 'gte', left: path('nope'), right: literal(0) }, document),
    ).toBe(false);
  });

  it('subset: true when every left element matches some right element', () => {
    expect(
      evaluateInvariant(
        { kind: 'subset', left: literal([1, 2]), right: literal([2, 1, 3]) },
        document,
      ),
    ).toBe(true);
    expect(
      evaluateInvariant(
        { kind: 'subset', left: literal([1, 4]), right: literal([1, 2, 3]) },
        document,
      ),
    ).toBe(false);
  });

  it('contains: true if the collection has a deep-equal element', () => {
    expect(
      evaluateInvariant(
        { kind: 'contains', collection: literal([{ a: 1 }, { a: 2 }]), value: literal({ a: 2 }) },
        document,
      ),
    ).toBe(true);
  });

  it('all/any/not compose correctly, with vacuous truth for empty "all"', () => {
    expect(evaluateInvariant({ kind: 'all', operands: [] }, document)).toBe(true);
    expect(evaluateInvariant({ kind: 'any', operands: [] }, document)).toBe(false);
    expect(
      evaluateInvariant(
        { kind: 'not', operand: { kind: 'exists', target: path('nope') } },
        document,
      ),
    ).toBe(true);
  });

  it('if: branches on the condition', () => {
    const expr: Expr = {
      kind: 'if',
      condition: { kind: 'exists', target: path('status') },
      then: { kind: 'eq', left: path('status'), right: literal('ok') },
      else: literal(false),
    };
    expect(evaluateInvariant(expr, document)).toBe(true);
  });

  it('a non-boolean top-level value (e.g. a bare literal) coerces to false, never throws', () => {
    expect(evaluateInvariant(literal('truthy-looking-string'), document)).toBe(false);
    expect(evaluateInvariant(literal(0), document)).toBe(false);
  });
});
