import { isSafeNumber, parse as parseLossless } from 'lossless-json';
import type { JsonValue } from '../domain/json.js';
import { BoundsError, InputEnvelopeError } from '../errors.js';
import { assertSafeObjectGraph } from './safe-object.js';

export interface DecodeJsonOptions {
  /** Hard cap on the UTF-8 byte length of `text`, checked before parsing begins. */
  readonly maxBytes: number;
  /** Hard cap on object/array nesting depth. */
  readonly maxDepth: number;
  /** Hard cap on the total number of object-property + array-element nodes. */
  readonly maxNodes: number;
}

/**
 * Parses `text` as a single bounded JSON value.
 *
 * Unlike `JSON.parse`, this:
 *
 * - Rejects duplicate object keys instead of silently keeping the last value (prevents a
 *   validator and a later reader from observing different data for the same key).
 * - Rejects numeric literals that cannot be represented exactly as an IEEE-754 `number`
 *   (fail-closed instead of silently truncating large integers/decimals).
 * - Rejects prototype-pollution-sensitive keys (`__proto__`, `constructor`, `prototype`)
 *   and anything that is not a plain object/array/primitive.
 * - Enforces byte-length, nesting-depth, and node-count ceilings before/while parsing.
 *
 * Throws {@link InputEnvelopeError} for syntax/semantic decode failures and
 * {@link BoundsError} when a configured limit is exceeded.
 */
export function decodeBoundedJson(text: string, options: DecodeJsonOptions): JsonValue {
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > options.maxBytes) {
    throw new BoundsError(
      'bounds.max-bytes-exceeded',
      `JSON input is ${byteLength} bytes, exceeding the ${options.maxBytes} byte limit.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseLossless(text, undefined, {
      parseNumber: (value: string) => {
        if (!isSafeNumber(value)) {
          throw new InputEnvelopeError(
            'input.unsafe-number',
            `Number "${value}" cannot be represented exactly as a JSON number without losing information.`,
          );
        }
        return Number.parseFloat(value);
      },
      onDuplicateKey: ({ key }: { key: string }) => {
        throw new InputEnvelopeError('input.duplicate-key', `Duplicate JSON key "${key}".`);
      },
    });
  } catch (error) {
    if (error instanceof InputEnvelopeError) {
      throw error;
    }
    throw new InputEnvelopeError(
      'input.invalid-json',
      'Input is not syntactically valid JSON.',
      error,
    );
  }

  assertSafeObjectGraph(parsed, { maxDepth: options.maxDepth, maxNodes: options.maxNodes });
  return parsed as JsonValue;
}
