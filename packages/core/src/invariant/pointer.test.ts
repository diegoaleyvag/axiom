import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BoundsError, ConfigError } from '../errors.js';
import { formatPointer, parsePointer, parseSelector } from './pointer.js';

const POINTER_LIMITS = { maxSegments: 32, maxSegmentLength: 256 };
const SELECTOR_LIMITS = { ...POINTER_LIMITS, maxWildcards: 8 };

describe('parsePointer', () => {
  it('parses the empty pointer as the whole document', () => {
    expect(parsePointer('', POINTER_LIMITS)).toEqual([]);
  });

  it('parses simple and multi-segment pointers', () => {
    expect(parsePointer('/a', POINTER_LIMITS)).toEqual(['a']);
    expect(parsePointer('/a/b/0', POINTER_LIMITS)).toEqual(['a', 'b', '0']);
  });

  it('unescapes "~1" to "/" and "~0" to "~"', () => {
    expect(parsePointer('/a~1b', POINTER_LIMITS)).toEqual(['a/b']);
    expect(parsePointer('/a~0b', POINTER_LIMITS)).toEqual(['a~b']);
    expect(parsePointer('/a~01', POINTER_LIMITS)).toEqual(['a~1']);
  });

  it('parses a pointer to the empty-string key', () => {
    expect(parsePointer('/', POINTER_LIMITS)).toEqual(['']);
  });

  it('rejects a pointer that does not start with "/" (and is not empty)', () => {
    expect(() => parsePointer('a/b', POINTER_LIMITS)).toThrow(ConfigError);
  });

  it('rejects a dangling "~" not followed by "0" or "1"', () => {
    expect(() => parsePointer('/a~b', POINTER_LIMITS)).toThrow(ConfigError);
    expect(() => parsePointer('/a~', POINTER_LIMITS)).toThrow(ConfigError);
  });

  it('rejects a pointer with more segments than maxSegments', () => {
    const raw = Array.from({ length: 5 }, (_, i) => `/s${i}`).join('');
    expect(() => parsePointer(raw, { ...POINTER_LIMITS, maxSegments: 3 })).toThrow(BoundsError);
  });

  it('rejects a segment longer than maxSegmentLength', () => {
    expect(() =>
      parsePointer(`/${'x'.repeat(10)}`, { ...POINTER_LIMITS, maxSegmentLength: 5 }),
    ).toThrow(BoundsError);
  });
});

describe('formatPointer', () => {
  it('escapes "~" and "/" when formatting segments back into a pointer', () => {
    expect(formatPointer(['a/b'])).toBe('/a~1b');
    expect(formatPointer(['a~b'])).toBe('/a~0b');
    expect(formatPointer([])).toBe('');
  });

  it('round-trips through parsePointer for arbitrary segment lists', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 20 }), { maxLength: 10 }), (segments) => {
        const formatted = formatPointer(segments);
        expect(parsePointer(formatted, { maxSegments: 100, maxSegmentLength: 100 })).toEqual(
          segments,
        );
      }),
      { numRuns: 500 },
    );
  });
});

describe('parseSelector', () => {
  it('parses exact segments and "*" wildcards', () => {
    expect(parseSelector('/a/*/c', SELECTOR_LIMITS)).toEqual([
      { kind: 'exact', key: 'a' },
      { kind: 'wildcard' },
      { kind: 'exact', key: 'c' },
    ]);
  });

  it('rejects more wildcard segments than maxWildcards', () => {
    expect(() => parseSelector('/*/*/*', { ...SELECTOR_LIMITS, maxWildcards: 2 })).toThrow(
      BoundsError,
    );
  });

  it('treats a literal "*" only as a wildcard, never as a regular key needing escaping', () => {
    // A key that happens to be the single character "*" cannot be selected exactly by this
    // grammar -- this is a deliberate, documented limitation of the bounded selector.
    expect(parseSelector('/*', SELECTOR_LIMITS)).toEqual([{ kind: 'wildcard' }]);
  });
});
