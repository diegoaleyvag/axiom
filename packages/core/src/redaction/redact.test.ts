import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../domain/json.js';
import { parseSelector } from '../invariant/pointer.js';
import { compileRedactionPattern } from './patterns.js';
import {
  REDACTED_VALUE_PLACEHOLDER,
  redactText,
  redactValue,
  type RedactionRules,
} from './redact.js';

const SELECTOR_LIMITS = { maxSegments: 32, maxSegmentLength: 128, maxWildcards: 8 };
const PATTERN_LIMITS = { maxPatternLength: 256 };

function rulesFor(paths: readonly string[], patterns: readonly string[]): RedactionRules {
  return {
    pathSegments: paths.map((selector) => parseSelector(selector, SELECTOR_LIMITS)),
    patterns: patterns.map((pattern) => compileRedactionPattern(pattern, [], PATTERN_LIMITS)),
  };
}

describe('redactValue', () => {
  it('redacts an exact configured path', () => {
    const rules = rulesFor(['/secret'], []);
    expect(redactValue({ secret: 'value', kept: 'value' }, rules)).toEqual({
      secret: REDACTED_VALUE_PLACEHOLDER,
      kept: 'value',
    });
  });

  it('redacts through a wildcard path segment', () => {
    const rules = rulesFor(['/items/*/token'], []);
    const input: JsonValue = {
      items: [
        { token: 'a', name: 'x' },
        { token: 'b', name: 'y' },
      ],
    };
    expect(redactValue(input, rules)).toEqual({
      items: [
        { token: REDACTED_VALUE_PLACEHOLDER, name: 'x' },
        { token: REDACTED_VALUE_PLACEHOLDER, name: 'y' },
      ],
    });
  });

  it('redacts array elements matched by a wildcard', () => {
    const rules = rulesFor(['/list/*'], []);
    expect(redactValue({ list: [1, 2, 3] }, rules)).toEqual({
      list: [REDACTED_VALUE_PLACEHOLDER, REDACTED_VALUE_PLACEHOLDER, REDACTED_VALUE_PLACEHOLDER],
    });
  });

  it('leaves values untouched when the path segment cannot descend into a scalar', () => {
    const rules = rulesFor(['/a/b'], []);
    expect(redactValue({ a: 'scalar' }, rules)).toEqual({ a: 'scalar' });
  });

  it('redacts a whole string leaf when a pattern matches anywhere inside it', () => {
    const rules = rulesFor([], ['sk-[A-Za-z0-9]+']);
    expect(redactValue({ note: 'token is sk-abc123 in the middle' }, rules)).toEqual({
      note: REDACTED_VALUE_PLACEHOLDER,
    });
  });

  it("never reveals the redacted value's length or prefix (fixed-length placeholder only)", () => {
    const rules = rulesFor(['/secret'], []);
    const short = redactValue({ secret: 'x' }, rules) as { secret: string };
    const long = redactValue({ secret: 'x'.repeat(500) }, rules) as { secret: string };
    expect(short.secret).toBe(long.secret);
    expect(short.secret).toBe(REDACTED_VALUE_PLACEHOLDER);
  });

  it('does not mutate the input value', () => {
    const rules = rulesFor(['/secret'], []);
    const input = { secret: 'value', kept: 'value' };
    redactValue(input, rules);
    expect(input).toEqual({ secret: 'value', kept: 'value' });
  });

  it('is idempotent: redacting an already-redacted value changes nothing further', () => {
    fc.assert(
      fc.property(
        fc.jsonValue({ maxDepth: 4 }).map((value) => value as JsonValue),
        (value) => {
          const rules = rulesFor(['/a/*/b', '/x'], ['secret-[0-9]+']);
          const once = redactValue(value, rules);
          const twice = redactValue(once, rules);
          expect(twice).toEqual(once);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a canary string injected anywhere never survives redaction once a matching pattern is configured', () => {
    const canary = 'CANARY-SECRET-VALUE-42';
    const rules = rulesFor([], ['CANARY-SECRET-VALUE-\\d+']);

    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 10 }), { maxLength: 5 }),
        fc.array(fc.string({ maxLength: 10 }), { maxLength: 5 }),
        (keys, values) => {
          const object: Record<string, JsonValue> = {};
          for (const [index, key] of keys.entries()) {
            object[key || `k${index}`] = values[index] ?? null;
          }
          const withCanary: JsonValue = { ...object, injected: canary, nested: { deep: [canary] } };
          const redacted = JSON.stringify(redactValue(withCanary, rules));
          expect(redacted.includes(canary)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('redactText', () => {
  it('redacts free-form text against configured patterns', () => {
    const patterns = [compileRedactionPattern('sk-[A-Za-z0-9]+', [], PATTERN_LIMITS)];
    expect(redactText('error using sk-abc123 in request', patterns)).toBe(
      `error using ${REDACTED_VALUE_PLACEHOLDER} in request`,
    );
  });

  it('returns the input unchanged when there are no patterns', () => {
    expect(redactText('nothing to redact', [])).toBe('nothing to redact');
  });
});
