import { ConfigError } from '../errors.js';

/** An exact rational value: `numerator / denominator`, `denominator` always positive. */
export interface ExactFraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Parses a fixed decimal string (e.g. `"-0.05"`, `"3"`, `"12.500"`) into an {@link
 * ExactFraction} using `BigInt` arithmetic, never a binary float -- the plan's "compare
 * ratios by cross multiplication/fixed decimal parsing, never binary floats" requirement.
 * Throws {@link ConfigError} for anything that is not a plain, finite fixed-point decimal
 * (no exponents, no `Infinity`/`NaN`, no thousands separators).
 */
export function parseExactDecimal(text: string, fieldLabel: string): ExactFraction {
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new ConfigError(
      'config.invalid-decimal',
      `${fieldLabel} must be a plain fixed decimal number (e.g. "0.05"), got "${text}".`,
    );
  }
  const [, sign, wholePart, fractionPart = ''] = match;
  const denominator = 10n ** BigInt(fractionPart.length);
  const magnitude = BigInt(wholePart + fractionPart);
  const numerator = sign === '-' ? -magnitude : magnitude;
  return { numerator, denominator };
}

/** Convenience wrapper for call sites (e.g. config compilation) that only need to validate syntax. */
export function parseExactDecimalOrThrow(text: string, fieldLabel: string): ExactFraction {
  return parseExactDecimal(text, fieldLabel);
}

/**
 * Compares `a` and `b` by cross multiplication (`a.numerator * b.denominator` vs
 * `b.numerator * a.denominator`), never by converting to a floating-point ratio. Both
 * denominators must be strictly positive.
 */
export function compareFractions(a: ExactFraction, b: ExactFraction): -1 | 0 | 1 {
  const left = a.numerator * b.denominator;
  const right = b.numerator * a.denominator;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function addFractions(a: ExactFraction, b: ExactFraction): ExactFraction {
  return {
    numerator: a.numerator * b.denominator + b.numerator * a.denominator,
    denominator: a.denominator * b.denominator,
  };
}

export function subtractFractions(a: ExactFraction, b: ExactFraction): ExactFraction {
  return addFractions(a, { numerator: -b.numerator, denominator: b.denominator });
}

/**
 * Formats an exact `numerator / denominator` integer ratio as a fixed-decimal string with
 * `precision` digits after the point, computed entirely with `BigInt` long division (never a
 * binary float division). Returns `null` for a zero denominator -- the report model's
 * explicit "insufficient data" representation instead of `NaN`/`Infinity`.
 */
export function formatRatio(numerator: number, denominator: number, precision = 6): string | null {
  if (denominator === 0) return null;
  const negative = numerator < 0;
  const scale = 10n ** BigInt(precision);
  const scaled = (BigInt(Math.abs(numerator)) * scale) / BigInt(denominator);
  const scaledText = scaled.toString().padStart(precision + 1, '0');
  const wholePart = scaledText.slice(0, scaledText.length - precision) || '0';
  const fractionPart = precision > 0 ? `.${scaledText.slice(scaledText.length - precision)}` : '';
  return `${negative && scaled !== 0n ? '-' : ''}${wholePart}${fractionPart}`;
}

/** `fraction` as an {@link ExactFraction}, for combining metric ratios with parsed decimal amounts. */
export function fractionOf(numerator: number, denominator: number): ExactFraction {
  return { numerator: BigInt(numerator), denominator: BigInt(Math.max(denominator, 1)) };
}
