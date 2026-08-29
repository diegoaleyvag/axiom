import { describe, expect, it } from 'vitest';
import { createAjv } from './ajv-factory.js';

const LIMITS = { maxPatternLength: 256 };

describe('createAjv', () => {
  it('asserts formats instead of merely annotating them', () => {
    const ajv = createAjv(LIMITS);
    const validate = ajv.compile({ type: 'string', format: 'date-time' });
    expect(validate('2024-01-01T00:00:00Z')).toBe(true);
    expect(validate('not-a-date-time')).toBe(false);
  });

  it('throws at compile time on an unresolvable local $ref instead of attempting network access', () => {
    const ajv = createAjv(LIMITS);
    expect(() =>
      ajv.compile({
        type: 'object',
        properties: { a: { $ref: 'https://example.invalid/never-fetched.json' } },
      }),
    ).toThrow();
  });

  it('strict mode rejects an unknown keyword at compile time', () => {
    const ajv = createAjv(LIMITS);
    expect(() => ajv.compile({ type: 'string', totallyMadeUpKeyword: true } as never)).toThrow();
  });

  it('keeps distinct "pattern" keywords distinct across multiple schemas in one Ajv instance', () => {
    // Regression test: Ajv's codegen de-duplicates compiled patterns by calling
    // `.toString()` on whatever `code.regExp` returns and using that as a cache key. If
    // the returned object does not override `toString`, every distinct pattern collapses
    // onto the same "[object Object]" key and Ajv silently reuses the *first* compiled
    // pattern for every subsequent one -- see the `toString` contract on `RegExpLike`.
    const ajv = createAjv(LIMITS);
    const validateDigits = ajv.compile({ type: 'string', pattern: '^[0-9]+$' });
    const validateLetters = ajv.compile({ type: 'string', pattern: '^[a-z]+$' });

    expect(validateDigits('12345')).toBe(true);
    expect(validateDigits('abcde')).toBe(false);
    expect(validateLetters('abcde')).toBe(true);
    expect(validateLetters('12345')).toBe(false);
  });

  it('routes the "pattern" keyword through the bounded RE2 engine (no ReDoS on adversarial input)', () => {
    const ajv = createAjv(LIMITS);
    const validate = ajv.compile({ type: 'string', pattern: '(a+)+$' });

    const start = performance.now();
    const result = validate(`${'a'.repeat(50_000)}!`);
    const elapsedMs = performance.now() - start;

    expect(result).toBe(false);
    expect(elapsedMs).toBeLessThan(2000);
  });

  it('never injects a default for a missing property', () => {
    const ajv = createAjv(LIMITS);
    const validate = ajv.compile({
      type: 'object',
      additionalProperties: false,
      properties: { n: { type: 'number', default: 1 } },
    });
    const data: Record<string, unknown> = {};
    validate(data);
    expect(Object.hasOwn(data, 'n')).toBe(false);
  });

  it('never coerces a wrong-type value or strips an additional property', () => {
    const ajv = createAjv(LIMITS);
    const validate = ajv.compile({
      type: 'object',
      additionalProperties: false,
      properties: { n: { type: 'number' } },
    });
    const data: Record<string, unknown> = { n: '5', extra: 'kept' };
    const result = validate(data);
    expect(result).toBe(false);
    expect(data['n']).toBe('5');
    expect(data['extra']).toBe('kept');
  });
});
