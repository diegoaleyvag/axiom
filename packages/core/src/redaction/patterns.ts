import { RE2JS } from 're2js';
import { BoundsError, ConfigError } from '../errors.js';

export interface RedactionPatternLimits {
  readonly maxPatternLength: number;
}

export interface CompiledRedactionPattern {
  test(input: string): boolean;
  /** Replaces every match of the pattern in `input` with `placeholder`. */
  redact(input: string, placeholder: string): string;
}

const FLAG_MAP: Record<string, number> = {
  i: RE2JS.CASE_INSENSITIVE,
  m: RE2JS.MULTILINE,
  s: RE2JS.DOTALL,
};

function translateFlags(flags: readonly string[]): number {
  let combined = 0;
  for (const flag of flags) {
    const mapped = FLAG_MAP[flag];
    if (mapped !== undefined) {
      combined |= mapped;
    }
  }
  return combined;
}

/**
 * Compiles one configured redaction pattern through RE2 (see
 * `../schema/regex-engine.js` for the same rationale applied to schema `pattern`
 * keywords): redaction runs against attacker-influenced candidate/command output, so it
 * must never be able to catastrophically backtrack.
 *
 * Kept distinct from {@link import('../schema/regex-engine.js').compileBoundedPattern}
 * because redaction additionally needs substring replacement (`redact`), not just a
 * boolean `test` -- a capability Ajv's `code.regExp` contract deliberately does not
 * expose.
 */
export function compileRedactionPattern(
  pattern: string,
  flags: readonly string[],
  limits: RedactionPatternLimits,
): CompiledRedactionPattern {
  if (pattern.length > limits.maxPatternLength) {
    throw new BoundsError(
      'bounds.pattern-too-long',
      `Redaction pattern exceeds the maximum length of ${limits.maxPatternLength} characters.`,
    );
  }

  let compiled: ReturnType<typeof RE2JS.compile>;
  try {
    compiled = RE2JS.compile(pattern, translateFlags(flags));
  } catch (error) {
    throw new ConfigError(
      'config.invalid-pattern',
      `Redaction pattern is not valid RE2 syntax: ${pattern}`,
      error,
    );
  }

  return {
    test: (input) => compiled.test(input),
    redact: (input, placeholder) => compiled.matcher(input).replaceAll(placeholder),
  };
}
