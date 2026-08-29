import { isJsonObject, type JsonValue } from '../domain/json.js';
import type { SelectorSegment } from '../invariant/pointer.js';
import type { CompiledRedactionPattern } from './patterns.js';

/** Fixed-length, content-free placeholder: never leaks the redacted value's length or prefix. */
export const REDACTED_VALUE_PLACEHOLDER = '[redacted]';

/**
 * A schema-valid stand-in for {@link REDACTED_VALUE_PLACEHOLDER} used anywhere the redacted
 * text must still satisfy `schemas/axiom-report.v1.schema.json`'s `$defs.id` pattern
 * (`^[A-Za-z][A-Za-z0-9_-]{0,63}$`) -- most notably a finding's `ruleId`. The bracketed
 * placeholder would itself violate that pattern, which would otherwise turn "redact a
 * ruleId" into "produce a schema-invalid report" the moment any configured pattern happened
 * to match inside one. Reserved exclusively for identifier-shaped fields; every other
 * redacted field (a value, a free-form `code`, a `pointer`) keeps using
 * {@link REDACTED_VALUE_PLACEHOLDER}.
 */
export const REDACTED_ID_PLACEHOLDER = 'redacted';

export interface RedactionRules {
  readonly pathSegments: readonly (readonly SelectorSegment[])[];
  readonly patterns: readonly CompiledRedactionPattern[];
}

/**
 * Redacts a JSON value against configured paths and patterns, in that order, returning a
 * new value (the input is never mutated).
 *
 * - Every configured path (a bounded selector, exact segments or `*`) that matches
 *   replaces the *value* found there with {@link REDACTED_VALUE_PLACEHOLDER}, regardless of
 *   its content.
 * - Every remaining string leaf is then tested against every configured pattern; a match
 *   anywhere in the string replaces the *entire* string with the placeholder (never a
 *   partial substring substitution), so matched length/prefix/suffix can never leak.
 *
 * This is intentionally generic over "a JSON value" rather than "a report": it is the one
 * choke point later reused for report bodies, redacted config echoes, and any other
 * structured value that might contain configured-sensitive data. Pure and idempotent:
 * redacting an already-redacted value returns the same value.
 */
export function redactValue(value: JsonValue, rules: RedactionRules): JsonValue {
  const afterPaths = rules.pathSegments.reduce(
    (current, segments) => applyPathRedaction(current, segments),
    value,
  );
  return rules.patterns.length === 0
    ? afterPaths
    : applyPatternRedaction(afterPaths, rules.patterns);
}

function applyPathRedaction(value: JsonValue, segments: readonly SelectorSegment[]): JsonValue {
  if (segments.length === 0) {
    return REDACTED_VALUE_PLACEHOLDER;
  }
  const [head, ...rest] = segments as [SelectorSegment, ...SelectorSegment[]];

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      matchesSegment(head, String(index)) ? redactMatchedLocation(item, rest) : item,
    );
  }
  if (isJsonObject(value)) {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = matchesSegment(head, key) ? redactMatchedLocation(item, rest) : item;
    }
    return out;
  }
  // A scalar was reached before the selector was exhausted: there is nothing deeper to
  // redact, so it is returned unchanged rather than treated as a match.
  return value;
}

function redactMatchedLocation(
  value: JsonValue,
  remainingSegments: readonly SelectorSegment[],
): JsonValue {
  return remainingSegments.length === 0
    ? REDACTED_VALUE_PLACEHOLDER
    : applyPathRedaction(value, remainingSegments);
}

function matchesSegment(segment: SelectorSegment, key: string): boolean {
  return segment.kind === 'wildcard' || segment.key === key;
}

/**
 * True when a concrete pointer's reference tokens (e.g. from a finding's location, or an
 * Ajv `instancePath`) are an exact-length match for one configured redaction/policy selector.
 * Reused so a finding's *pointer string* can be redacted at creation time (see
 * `../engine/evaluate-attempt.ts`) using the same path-matching semantics as
 * {@link redactValue}, without needing the candidate value itself.
 */
export function pointerMatchesSelector(
  pointerSegments: readonly string[],
  selector: readonly SelectorSegment[],
): boolean {
  if (pointerSegments.length !== selector.length) return false;
  return selector.every((segment, index) =>
    matchesSegment(segment, pointerSegments[index] as string),
  );
}

function applyPatternRedaction(
  value: JsonValue,
  patterns: readonly CompiledRedactionPattern[],
): JsonValue {
  if (typeof value === 'string') {
    return patterns.some((pattern) => pattern.test(value)) ? REDACTED_VALUE_PLACEHOLDER : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyPatternRedaction(item, patterns));
  }
  if (isJsonObject(value)) {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = applyPatternRedaction(item, patterns);
    }
    return out;
  }
  return value;
}

/** Redacts free-form text (not a JSON value) against configured patterns, in place of no structure to walk. */
export function redactText(text: string, patterns: readonly CompiledRedactionPattern[]): string {
  return patterns.reduce(
    (current, pattern) => pattern.redact(current, REDACTED_VALUE_PLACEHOLDER),
    text,
  );
}

/**
 * Redacts an identifier-shaped field (currently only a finding's `ruleId`) against
 * configured patterns. Unlike {@link redactText}'s substring replacement -- which is safe
 * for free-form text but would splice `REDACTED_VALUE_PLACEHOLDER`'s `[`/`]` characters
 * into the middle of a string that must keep matching the report schema's `$defs.id`
 * pattern -- this replaces the *entire* identifier with {@link REDACTED_ID_PLACEHOLDER}
 * the moment any pattern matches anywhere in it, guaranteeing the result is always
 * schema-valid regardless of where or how long the match was.
 */
export function redactId(id: string, patterns: readonly CompiledRedactionPattern[]): string {
  return patterns.some((pattern) => pattern.test(id)) ? REDACTED_ID_PLACEHOLDER : id;
}
