import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BoundsError } from '../errors.js';
import { assertSafeObjectGraph } from './safe-object.js';

const GENEROUS_LIMITS = { maxDepth: 64, maxNodes: 100_000 };

describe('assertSafeObjectGraph', () => {
  it('accepts plain scalars, arrays, and nested objects', () => {
    expect(() => assertSafeObjectGraph(null, GENEROUS_LIMITS)).not.toThrow();
    expect(() => assertSafeObjectGraph('hello', GENEROUS_LIMITS)).not.toThrow();
    expect(() => assertSafeObjectGraph(42, GENEROUS_LIMITS)).not.toThrow();
    expect(() =>
      assertSafeObjectGraph({ a: [1, 2, { b: 'c' }], d: null }, GENEROUS_LIMITS),
    ).not.toThrow();
  });

  it.each(['__proto__', 'constructor', 'prototype'])('rejects the reserved key "%s"', (key) => {
    const value = JSON.parse(`{"${key}": 1}`) as unknown;
    expect(() => assertSafeObjectGraph(value, GENEROUS_LIMITS)).toThrow(BoundsError);
  });

  it('rejects a reserved key nested deep inside arrays/objects', () => {
    const value = { a: [{ b: { c: JSON.parse('{"__proto__": {"polluted": true}}') } }] };
    expect(() => assertSafeObjectGraph(value, GENEROUS_LIMITS)).toThrow(BoundsError);
  });

  it('confirms JSON.parse itself never actually pollutes Object.prototype', () => {
    // Defense-in-depth sanity check: JSON.parse assigns object-literal properties with
    // CreateDataProperty semantics, so a "__proto__" key becomes a real own property
    // rather than reassigning the prototype -- this is *why* assertSafeObjectGraph must
    // check own keys explicitly instead of relying on the prototype chain looking normal.
    const parsed = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true);
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects a value nested deeper than maxDepth', () => {
    let value: unknown = 'leaf';
    for (let i = 0; i < 5; i += 1) {
      value = { nested: value };
    }
    expect(() => assertSafeObjectGraph(value, { maxDepth: 3, maxNodes: 1000 })).toThrow(
      BoundsError,
    );
    expect(() => assertSafeObjectGraph(value, { maxDepth: 10, maxNodes: 1000 })).not.toThrow();
  });

  it('rejects a value with more nodes than maxNodes', () => {
    const value = { a: 1, b: 2, c: 3, d: 4 };
    expect(() => assertSafeObjectGraph(value, { maxDepth: 10, maxNodes: 2 })).toThrow(BoundsError);
    expect(() => assertSafeObjectGraph(value, { maxDepth: 10, maxNodes: 10 })).not.toThrow();
  });

  it('rejects functions, symbols, and bigints wherever they appear', () => {
    expect(() => assertSafeObjectGraph(() => {}, GENEROUS_LIMITS)).toThrow(BoundsError);
    expect(() => assertSafeObjectGraph({ a: [1, () => {}] }, GENEROUS_LIMITS)).toThrow(BoundsError);
  });

  it('rejects an object with a non-plain prototype', () => {
    class Exotic {
      x = 1;
    }
    expect(() => assertSafeObjectGraph(new Exotic(), GENEROUS_LIMITS)).toThrow(BoundsError);
  });
});

const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const;
const SAFE_KEYS = ['a', 'b', 'c', 'd'] as const;

/**
 * Recursively builds a random object/array/scalar graph, tracking (as independent ground
 * truth) whether any reserved key was planted anywhere in it as a genuine *own* property.
 * Keys are always assigned via a computed property name (`{[key]: value}`), which -- unlike
 * the literal `{__proto__: value}` syntax -- never triggers the `Object.prototype.__proto__`
 * accessor (see Annex B.3.1's "__proto__ Property Names in Object Initializers": the special
 * case applies only to a *non-computed* property named exactly `__proto__`). This mirrors
 * what `JSON.parse` produces (a real own property, never a prototype reassignment) without
 * this test file needing to round-trip everything through `JSON.stringify`/`JSON.parse`.
 */
function buildGraph(spec: GraphSpec): { value: unknown; hasDangerousKey: boolean } {
  if (spec.kind === 'scalar') {
    return { value: spec.value, hasDangerousKey: false };
  }
  if (spec.kind === 'array') {
    const built = spec.items.map(buildGraph);
    return {
      value: built.map((b) => b.value),
      hasDangerousKey: built.some((b) => b.hasDangerousKey),
    };
  }
  // A duplicate key overwrites the earlier entry entirely (matching real object-literal/
  // JSON.parse semantics), so both its value *and* whatever "dangerous key" it carried
  // further down must be attributed only to whichever entry actually survives.
  const lastByKey = new Map(spec.entries);
  const object: Record<string, unknown> = {};
  let hasDangerousKey = false;
  for (const [key, childSpec] of lastByKey) {
    const child = buildGraph(childSpec);
    Object.defineProperty(object, key, {
      value: child.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    hasDangerousKey =
      hasDangerousKey || child.hasDangerousKey || DANGEROUS_KEYS.includes(key as never);
  }
  return { value: object, hasDangerousKey };
}

type GraphSpec =
  | { kind: 'scalar'; value: string | number | boolean | null }
  | { kind: 'array'; items: readonly GraphSpec[] }
  | { kind: 'object'; entries: readonly (readonly [string, GraphSpec])[] };

const scalarSpec = fc.oneof(
  fc.string({ maxLength: 5 }).map((value) => ({ kind: 'scalar', value }) as const),
  fc.integer().map((value) => ({ kind: 'scalar', value }) as const),
  fc.boolean().map((value) => ({ kind: 'scalar', value }) as const),
  fc.constant({ kind: 'scalar', value: null }) as fc.Arbitrary<GraphSpec>,
);

const keyArb = fc.oneof(
  { arbitrary: fc.constantFrom(...SAFE_KEYS), weight: 4 },
  {
    arbitrary: fc.constantFrom(...DANGEROUS_KEYS),
    weight: 1,
  },
);

const graphSpecArb = fc.letrec<{ node: GraphSpec }>((tie) => ({
  node: fc.oneof(
    { arbitrary: scalarSpec, weight: 2 },
    {
      arbitrary: fc
        .array(tie('node') as fc.Arbitrary<GraphSpec>, { maxLength: 3 })
        .map((items) => ({ kind: 'array', items }) as const),
      weight: 1,
    },
    {
      arbitrary: fc
        .array(fc.tuple(keyArb, tie('node') as fc.Arbitrary<GraphSpec>), { maxLength: 3 })
        .map((entries) => ({ kind: 'object', entries }) as const),
      weight: 1,
    },
  ),
})).node;

describe('assertSafeObjectGraph: property (prototype-pollution fuzz)', () => {
  it('rejects a graph iff it contains a reserved key as a genuine own property anywhere, within generous bounds', () => {
    fc.assert(
      fc.property(fc.array(graphSpecArb, { maxLength: 3 }), (specs) => {
        const built = specs.map(buildGraph);
        const value = built.length === 1 ? built[0]?.value : built.map((b) => b.value);
        const expectDangerous = built.some((b) => b.hasDangerousKey);

        // Bounds generous enough that only the dangerous-key check can possibly fire, given
        // this generator's small maxLength/depth caps.
        const limits = { maxDepth: 20, maxNodes: 1000 };

        if (expectDangerous) {
          expect(() => assertSafeObjectGraph(value, limits)).toThrow(BoundsError);
        } else {
          expect(() => assertSafeObjectGraph(value, limits)).not.toThrow();
        }
      }),
      { numRuns: 500 },
    );
  });
});
