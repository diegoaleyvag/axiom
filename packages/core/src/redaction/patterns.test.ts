import { describe, expect, it } from 'vitest';
import { BoundsError, ConfigError } from '../errors.js';
import { compileRedactionPattern } from './patterns.js';

const LIMITS = { maxPatternLength: 256 };

describe('compileRedactionPattern', () => {
  it('tests and redacts matches', () => {
    const pattern = compileRedactionPattern('sk-[A-Za-z0-9]+', [], LIMITS);
    expect(pattern.test('token=sk-abc123')).toBe(true);
    expect(pattern.test('nothing here')).toBe(false);
    expect(pattern.redact('token=sk-abc123 end', '[redacted]')).toBe('token=[redacted] end');
  });

  it('redacts every occurrence, not just the first', () => {
    const pattern = compileRedactionPattern('sk-[A-Za-z0-9]+', [], LIMITS);
    expect(pattern.redact('a=sk-111 b=sk-222', '[redacted]')).toBe('a=[redacted] b=[redacted]');
  });

  it('rejects a pattern over the length cap', () => {
    expect(() => compileRedactionPattern('a'.repeat(1000), [], LIMITS)).toThrow(BoundsError);
  });

  it('rejects invalid RE2 syntax', () => {
    expect(() => compileRedactionPattern('(unclosed', [], LIMITS)).toThrow(ConfigError);
  });
});
