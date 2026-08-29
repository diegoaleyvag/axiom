import type { JsonValue } from '../domain/json.js';
import { isJsonObject } from '../domain/json.js';
import type { SelectorSegment } from '../invariant/pointer.js';
import { MISSING, type EvalValue } from './values.js';

const ARRAY_INDEX_PATTERN = /^(?:0|[1-9][0-9]*)$/;

/** Resolves one RFC 6901 reference token against a single container value, or {@link MISSING}. */
function step(container: JsonValue, key: string): EvalValue {
  if (Array.isArray(container)) {
    if (!ARRAY_INDEX_PATTERN.test(key)) {
      return MISSING;
    }
    const index = Number.parseInt(key, 10);
    return index < container.length ? (container[index] as JsonValue) : MISSING;
  }
  if (isJsonObject(container)) {
    return Object.hasOwn(container, key) ? (container[key] as JsonValue) : MISSING;
  }
  // Indexing into a scalar (string/number/boolean/null): a type mismatch that fails closed
  // to MISSING rather than throwing, per the invariant grammar's "missing sentinel" contract.
  return MISSING;
}

/**
 * Resolves an exact RFC 6901 pointer's reference tokens against `document`. Total for any
 * input: an out-of-range index, a missing key, or a segment applied to a scalar all resolve
 * to {@link MISSING} rather than throwing.
 */
export function resolvePath(document: JsonValue, segments: readonly string[]): EvalValue {
  let current: EvalValue = document;
  for (const segment of segments) {
    if (current === MISSING) return MISSING;
    current = step(current, segment);
  }
  return current;
}

/**
 * Resolves a bounded selector (exact segments plus `*` wildcards) against `document`,
 * returning every matched value. A wildcard segment expands to every own key of an object or
 * every index of an array at that position; expansion through a scalar or a missing location
 * simply contributes no matches (fail-closed), so the result is always an array, never
 * {@link MISSING}, and its length is implicitly bounded by the document's own bounded node
 * count (see `../json/safe-object.ts`) combined with the selector's bounded wildcard count.
 */
export function resolveSelector(
  document: JsonValue,
  segments: readonly SelectorSegment[],
): readonly JsonValue[] {
  let current: readonly JsonValue[] = [document];
  for (const segment of segments) {
    const next: JsonValue[] = [];
    for (const value of current) {
      if (segment.kind === 'wildcard') {
        if (Array.isArray(value)) {
          next.push(...value);
        } else if (isJsonObject(value)) {
          next.push(...Object.values(value));
        }
        // A wildcard through a scalar contributes nothing.
      } else {
        const resolved = step(value, segment.key);
        if (resolved !== MISSING) {
          next.push(resolved);
        }
      }
    }
    current = next;
  }
  return current;
}
