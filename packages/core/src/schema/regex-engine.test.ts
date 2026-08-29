import { describe, expect, it } from 'vitest';
import { BoundsError, ConfigError } from '../errors.js';
import { compileBoundedPattern } from './regex-engine.js';

const LIMITS = { maxPatternLength: 256 };

describe('compileBoundedPattern', () => {
  it('compiles a simple pattern and matches/rejects accordingly', () => {
    const pattern = compileBoundedPattern('^[A-Za-z]+$', '', LIMITS);
    expect(pattern.test('Hello')).toBe(true);
    expect(pattern.test('Hello1')).toBe(false);
  });

  it('supports the "i" (case-insensitive) flag', () => {
    const pattern = compileBoundedPattern('^hello$', 'i', LIMITS);
    expect(pattern.test('HELLO')).toBe(true);
    expect(pattern.test('hello')).toBe(true);
  });

  it('rejects a pattern longer than maxPatternLength', () => {
    expect(() => compileBoundedPattern('a'.repeat(1000), '', LIMITS)).toThrow(BoundsError);
  });

  it('rejects RE2-unsupported syntax such as backreferences', () => {
    expect(() => compileBoundedPattern('(a)\\1', '', LIMITS)).toThrow(ConfigError);
  });

  it('resists catastrophic backtracking patterns within a tight time budget', () => {
    const pattern = compileBoundedPattern('(a+)+$', '', LIMITS);
    const adversarialInput = `${'a'.repeat(50_000)}!`;

    const start = performance.now();
    const matched = pattern.test(adversarialInput);
    const elapsedMs = performance.now() - start;

    expect(matched).toBe(false);
    // A backtracking engine would take exponential time on this input (seconds to
    // minutes); RE2's linear-time guarantee keeps this well under a second even on a slow
    // CI runner. This is the core "no ReDoS" property, not just a performance nicety.
    expect(elapsedMs).toBeLessThan(2000);
  });
});
