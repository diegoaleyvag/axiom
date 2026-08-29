import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BoundsError, InputEnvelopeError } from '../errors.js';
import { decodeBoundedJson } from './decode.js';

const OPTIONS = { maxBytes: 1024, maxDepth: 16, maxNodes: 1000 };

describe('decodeBoundedJson', () => {
  it('parses a well-formed JSON value', () => {
    expect(decodeBoundedJson('{"a":1,"b":[true,false,null,"x"]}', OPTIONS)).toEqual({
      a: 1,
      b: [true, false, null, 'x'],
    });
  });

  it('rejects syntactically invalid JSON', () => {
    expect(() => decodeBoundedJson('{not json', OPTIONS)).toThrow(InputEnvelopeError);
  });

  it('rejects duplicate object keys instead of silently keeping the last value', () => {
    expect(() => decodeBoundedJson('{"a":1,"a":2}', OPTIONS)).toThrow(InputEnvelopeError);
  });

  it('rejects numbers that cannot be represented exactly as a JS number', () => {
    expect(() => decodeBoundedJson('{"big": 123456789123456789123456789}', OPTIONS)).toThrow(
      InputEnvelopeError,
    );
    expect(() => decodeBoundedJson('{"huge": 2e500}', OPTIONS)).toThrow(InputEnvelopeError);
  });

  it('accepts numbers that round-trip exactly', () => {
    expect(decodeBoundedJson('{"n": 42, "f": 1.5, "neg": -3}', OPTIONS)).toEqual({
      n: 42,
      f: 1.5,
      neg: -3,
    });
  });

  it('rejects input over the byte cap before parsing', () => {
    const big = `{"a":"${'x'.repeat(2000)}"}`;
    expect(() => decodeBoundedJson(big, { ...OPTIONS, maxBytes: 100 })).toThrow(BoundsError);
  });

  it('rejects a "__proto__" own key even though it parses as valid JSON', () => {
    expect(() => decodeBoundedJson('{"__proto__": {"polluted": true}}', OPTIONS)).toThrow(
      BoundsError,
    );
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects structures deeper than maxDepth', () => {
    const deep = '{"a":{"a":{"a":{"a":{"a":1}}}}}';
    expect(() => decodeBoundedJson(deep, { ...OPTIONS, maxDepth: 2 })).toThrow(BoundsError);
  });

  it('is total over arbitrary strings: never throws anything but a typed AxiomError', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (input) => {
        try {
          decodeBoundedJson(input, OPTIONS);
        } catch (error) {
          expect(error instanceof InputEnvelopeError || error instanceof BoundsError).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
