import { RE2JS } from 're2js';
import { BoundsError, ConfigError } from '../errors.js';

/**
 * Minimal contract every pattern-matching call site in Axiom is allowed to depend on.
 * Deliberately narrower than a native `RegExp`: no `.exec`, `.source`, `.lastIndex`, or
 * global/sticky iteration state, so callers cannot accidentally depend on backtracking
 * regex semantics that RE2 does not provide.
 *
 * `toString()` is part of this contract, not an accident: Ajv's `usePattern` helper
 * de-duplicates compiled patterns in its codegen scope by calling `.toString()` on
 * whatever `code.regExp` returns and using that as the cache key (see
 * `ajv/dist/vocabularies/code.js`). A plain object without a `toString` override
 * inherits `Object.prototype.toString`, which returns the literal string
 * `"[object Object]"` for *every* pattern -- so Ajv would silently treat every distinct
 * pattern compiled in the same schema (or its meta-schema) as identical and reuse
 * whichever one happened to compile first. Returning a native-`RegExp`-shaped
 * `/pattern/flags` string keeps that de-duplication key unique per pattern+flags pair.
 */
export interface RegExpLike {
  test: (input: string) => boolean;
  toString: () => string;
}

/** Matches Ajv's `code.regExp` engine contract (see `ajv` `RegExpEngine`/`RegExpLike`). */
export interface AjvRegExpEngine {
  (pattern: string, flags: string): RegExpLike;
  code: string;
}

export interface BoundedPatternOptions {
  /** Hard cap on pattern source length, checked before compilation. */
  readonly maxPatternLength: number;
}

const SUPPORTED_FLAGS: Record<string, number> = {
  i: RE2JS.CASE_INSENSITIVE,
  m: RE2JS.MULTILINE,
  s: RE2JS.DOTALL,
};

function translateFlags(flags: string): number {
  let combined = 0;
  for (const flag of flags) {
    const mapped = SUPPORTED_FLAGS[flag];
    if (mapped !== undefined) {
      combined |= mapped;
    }
    // Unrecognized flags ("u", "g", "y", ...) are intentionally ignored: RE2 matches
    // Unicode code points by default, and "global"/"sticky" only affect native iteration
    // helpers that this bounded engine never exposes.
  }
  return combined;
}

/**
 * Compiles `pattern` through RE2 (linear-time, backtracking-free) instead of native
 * `RegExp`, so no configured or schema-declared pattern can cause catastrophic
 * backtracking regardless of the input it is later matched against.
 *
 * This is the single bounded pattern adapter shared by schema `pattern` validation,
 * forbidden-pattern policy checks, and redaction pattern matching (only the config-time
 * and redaction call sites exist yet; schema/policy evaluation is implemented later).
 *
 * Throws {@link BoundsError} if `pattern` exceeds `maxPatternLength`, or {@link
 * ConfigError} if `pattern` is not valid RE2 syntax (e.g. uses backreferences or
 * lookaround features RE2 does not support).
 */
export function compileBoundedPattern(
  pattern: string,
  flags: string,
  options: BoundedPatternOptions,
): RegExpLike {
  if (pattern.length > options.maxPatternLength) {
    throw new BoundsError(
      'bounds.pattern-too-long',
      `Pattern exceeds the maximum length of ${options.maxPatternLength} characters.`,
    );
  }

  let compiled: ReturnType<typeof RE2JS.compile>;
  try {
    compiled = RE2JS.compile(pattern, translateFlags(flags));
  } catch (error) {
    throw new ConfigError(
      'config.invalid-pattern',
      `Pattern is not valid RE2 syntax: ${pattern}`,
      error,
    );
  }

  return {
    test: (input: string) => compiled.test(input),
    toString: () => `/${pattern}/${flags}`,
  };
}

/**
 * Builds the `code.regExp` engine Ajv should use for every `pattern`/`patternProperties`
 * keyword it compiles, replacing Ajv's default native-`RegExp` engine everywhere.
 */
export function createAjvRegExpEngine(options: BoundedPatternOptions): AjvRegExpEngine {
  const engine = ((pattern: string, flags: string) =>
    compileBoundedPattern(pattern, flags, options)) as AjvRegExpEngine;
  engine.code = 're2js-bounded-pattern-engine';
  return engine;
}
