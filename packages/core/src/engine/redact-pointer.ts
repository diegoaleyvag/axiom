import type { SelectorSegment } from '../invariant/pointer.js';
import { formatPointer } from '../invariant/pointer.js';
import { pointerMatchesSelector, REDACTED_VALUE_PLACEHOLDER } from '../redaction/redact.js';

export interface RedactionSelectors {
  readonly pathSegments: readonly (readonly SelectorSegment[])[];
}

/**
 * Formats a finding's location as an RFC 6901 pointer string, replacing it outright with
 * {@link REDACTED_VALUE_PLACEHOLDER} if it falls under a configured redaction path -- applied
 * at finding-creation time (`./evaluate-attempt.ts`, `./policy.ts`) so a redacted field's
 * *location*, not only its value, never reaches a report.
 */
export function redactPointerSegments(
  segments: readonly string[],
  redaction: RedactionSelectors,
): string {
  const isRedacted = redaction.pathSegments.some((selector) =>
    pointerMatchesSelector(segments, selector),
  );
  return isRedacted ? REDACTED_VALUE_PLACEHOLDER : formatPointer(segments);
}
