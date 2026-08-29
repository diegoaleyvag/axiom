import { describe, expect, it } from 'vitest';
import { BoundsError, ConfigError, InputEnvelopeError, InternalError } from './errors.js';
import { EXIT_CODES, exitCodeForError } from './exit-code.js';

describe('exitCodeForError', () => {
  it('maps ConfigError to INVALID_INPUT', () => {
    expect(exitCodeForError(new ConfigError('config.x', 'bad config'))).toBe(
      EXIT_CODES.INVALID_INPUT,
    );
  });

  it('maps InputEnvelopeError to INVALID_INPUT', () => {
    expect(exitCodeForError(new InputEnvelopeError('input.x', 'bad envelope'))).toBe(
      EXIT_CODES.INVALID_INPUT,
    );
  });

  it('maps BoundsError to INVALID_INPUT', () => {
    expect(exitCodeForError(new BoundsError('bounds.x', 'too big'))).toBe(EXIT_CODES.INVALID_INPUT);
  });

  it('maps InternalError to INTERNAL_FAILURE', () => {
    expect(exitCodeForError(new InternalError('internal.x', 'oops'))).toBe(
      EXIT_CODES.INTERNAL_FAILURE,
    );
  });

  it('maps a native Error to INTERNAL_FAILURE, never CONTRACT_FAILURE', () => {
    expect(exitCodeForError(new TypeError('boom'))).toBe(EXIT_CODES.INTERNAL_FAILURE);
    expect(exitCodeForError(new RangeError('boom'))).toBe(EXIT_CODES.INTERNAL_FAILURE);
  });

  it('maps a non-Error throwable to INTERNAL_FAILURE', () => {
    expect(exitCodeForError('a plain string throw')).toBe(EXIT_CODES.INTERNAL_FAILURE);
    expect(exitCodeForError(undefined)).toBe(EXIT_CODES.INTERNAL_FAILURE);
    expect(exitCodeForError({ some: 'object' })).toBe(EXIT_CODES.INTERNAL_FAILURE);
  });

  it('never returns CONTRACT_FAILURE (1) for any thrown value', () => {
    const thrown = [
      new ConfigError('c', 'x'),
      new InputEnvelopeError('i', 'x'),
      new BoundsError('b', 'x'),
      new InternalError('e', 'x'),
      new Error('plain'),
      null,
      42,
    ];
    for (const value of thrown) {
      expect(exitCodeForError(value)).not.toBe(EXIT_CODES.CONTRACT_FAILURE);
    }
  });
});
