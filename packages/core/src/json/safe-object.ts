import { BoundsError } from '../errors.js';

/**
 * Own-property keys that are never allowed on a decoded config/artifact/report object,
 * regardless of whether the underlying parser already guards against prototype
 * pollution. This is deliberate defense-in-depth: it does not trust the YAML/JSON parser's
 * internals and instead re-checks every decoded object itself.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface SafeWalkLimits {
  /** Maximum object/array nesting depth (a scalar has depth 0). */
  readonly maxDepth: number;
  /** Maximum number of object-property + array-element nodes visited in total. */
  readonly maxNodes: number;
}

/**
 * Recursively verifies that a decoded value contains no prototype-pollution-sensitive
 * keys and stays within bounded depth/node limits, throwing a {@link BoundsError}
 * (never silently dropping or renaming data) on the first violation.
 *
 * Only ever called on values produced by our own bounded YAML/JSON decoders, which already
 * yield plain objects/arrays/primitives -- so encountering anything else (a class
 * instance, a `Map`, a function) is itself treated as a violation.
 */
export function assertSafeObjectGraph(value: unknown, limits: SafeWalkLimits): void {
  walk(value, limits, 0, { nodes: 0 }, '$');
}

function walk(
  value: unknown,
  limits: SafeWalkLimits,
  depth: number,
  counter: { nodes: number },
  pointer: string,
): void {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
      throw new BoundsError(
        'bounds.unsupported-value-type',
        `Unsupported decoded value type at ${pointer}.`,
      );
    }
    return;
  }

  if (depth > limits.maxDepth) {
    throw new BoundsError(
      'bounds.max-depth-exceeded',
      `Decoded structure exceeds the maximum nesting depth of ${limits.maxDepth} at ${pointer}.`,
    );
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      counter.nodes += 1;
      assertNodeBudget(counter.nodes, limits, pointer);
      walk(value[index], limits, depth + 1, counter, `${pointer}[${index}]`);
    }
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new BoundsError(
      'bounds.unsupported-value-type',
      `Decoded object at ${pointer} has an unexpected prototype.`,
    );
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') {
      throw new BoundsError(
        'bounds.unsupported-value-type',
        `Decoded object at ${pointer} has a symbol-keyed property.`,
      );
    }
    if (UNSAFE_KEYS.has(key)) {
      throw new BoundsError(
        'bounds.unsafe-key',
        `Decoded object at ${pointer} uses the reserved key "${key}".`,
      );
    }
    counter.nodes += 1;
    assertNodeBudget(counter.nodes, limits, pointer);
    walk((value as Record<string, unknown>)[key], limits, depth + 1, counter, `${pointer}.${key}`);
  }
}

function assertNodeBudget(nodes: number, limits: SafeWalkLimits, pointer: string): void {
  if (nodes > limits.maxNodes) {
    throw new BoundsError(
      'bounds.max-nodes-exceeded',
      `Decoded structure exceeds the maximum node count of ${limits.maxNodes} near ${pointer}.`,
    );
  }
}
