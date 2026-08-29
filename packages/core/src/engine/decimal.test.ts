import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../errors.js';
import {
  compareFractions,
  formatRatio,
  fractionOf,
  parseExactDecimal,
  subtractFractions,
} from './decimal.js';

describe('parseExactDecimal', () => {
  it('parses integers, decimals, and negative values exactly', () => {
    expect(parseExactDecimal('3', 'x')).toEqual({ numerator: 3n, denominator: 1n });
    expect(parseExactDecimal('0.05', 'x')).toEqual({ numerator: 5n, denominator: 100n });
    expect(parseExactDecimal('-0.5', 'x')).toEqual({ numerator: -5n, denominator: 10n });
    expect(parseExactDecimal('12.500', 'x')).toEqual({ numerator: 12500n, denominator: 1000n });
  });

  it('rejects exponents, NaN/Infinity, and thousands separators', () => {
    expect(() => parseExactDecimal('1e5', 'x')).toThrow(ConfigError);
    expect(() => parseExactDecimal('NaN', 'x')).toThrow(ConfigError);
    expect(() => parseExactDecimal('Infinity', 'x')).toThrow(ConfigError);
    expect(() => parseExactDecimal('1,000', 'x')).toThrow(ConfigError);
    expect(() => parseExactDecimal('', 'x')).toThrow(ConfigError);
  });
});

describe('compareFractions', () => {
  it('cross-multiplies rather than converting to float, avoiding precision loss', () => {
    const a = { numerator: 1n, denominator: 3n };
    const b = { numerator: 333333333333333n, denominator: 1000000000000000n };
    // 1/3 is (fractionally) larger than 0.333333333333333.
    expect(compareFractions(a, b)).toBe(1);
  });

  it('is zero for equal fractions with different representations', () => {
    expect(
      compareFractions({ numerator: 2n, denominator: 4n }, { numerator: 1n, denominator: 2n }),
    ).toBe(0);
  });

  it('handles negative numerators correctly', () => {
    expect(
      compareFractions({ numerator: -1n, denominator: 2n }, { numerator: 1n, denominator: 2n }),
    ).toBe(-1);
  });
});

describe('subtractFractions', () => {
  it('computes an exact difference', () => {
    const result = subtractFractions(
      { numerator: 3n, denominator: 4n },
      { numerator: 1n, denominator: 4n },
    );
    expect(compareFractions(result, { numerator: 1n, denominator: 2n })).toBe(0);
  });
});

describe('formatRatio', () => {
  it('is null for a zero denominator (never NaN/Infinity)', () => {
    expect(formatRatio(1, 0)).toBeNull();
  });

  it('formats exact fixed-point ratios without floating point drift', () => {
    expect(formatRatio(1, 3, 6)).toBe('0.333333');
    expect(formatRatio(2, 4, 2)).toBe('0.50');
    expect(formatRatio(10, 1, 0)).toBe('10');
  });

  it('property: formatRatio(n, d) truncates to exactly the [value, value + 1e-6) window around n/d', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 1, max: 1000 }), (n, d) => {
        const value = formatRatio(n, d, 6);
        const parsed = parseExactDecimal(value as string, 'test');
        const trueValue = fractionOf(n, d);
        const nextUnit = { numerator: parsed.numerator + 1n, denominator: parsed.denominator };
        expect(compareFractions(parsed, trueValue)).toBeLessThanOrEqual(0);
        expect(compareFractions(trueValue, nextUnit)).toBe(-1);
      }),
    );
  });
});
