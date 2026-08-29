const MAX_SEGMENTS = 64;
const MAX_SEGMENT_LENGTH = 256;
const TRUNCATION_MARKER = '\u2026';

/**
 * Parses an Ajv `instancePath` (or any other RFC-6901-shaped string produced while walking
 * *candidate* data, as opposed to config-authored pointers) into display segments without
 * ever throwing -- unlike `../invariant/pointer.ts`'s `parsePointer`, which is intentionally
 * strict for config-authored input. A candidate document's own key names are unbounded in
 * length even though the document's overall size/depth/node count is bounded (see
 * `../limits.ts`), so this defensively truncates instead of rejecting: a finding must always
 * be produced, never an exception, no matter how the candidate is shaped.
 */
export function safeParsePointerSegments(raw: string): readonly string[] {
  if (raw === '') return [];
  const tokens = raw.startsWith('/') ? raw.slice(1).split('/') : [raw];
  const bounded = tokens.slice(0, MAX_SEGMENTS).map((token) => {
    const unescaped = token.replace(/~1/g, '/').replace(/~0/g, '~');
    return boundCandidateSegment(unescaped);
  });
  if (tokens.length > MAX_SEGMENTS) {
    bounded.push(TRUNCATION_MARKER);
  }
  return bounded;
}

/**
 * Truncates a single candidate-controlled pointer segment (e.g. one object key name
 * discovered while walking candidate data, as opposed to a pointer string parsed
 * wholesale by {@link safeParsePointerSegments}) to {@link MAX_SEGMENT_LENGTH}. A
 * candidate document's individual key names are not bounded in length by the document's
 * overall byte/depth/node caps (see `../limits.ts`) -- a single key could legally consume
 * most of the document's byte budget -- so every raw candidate-derived segment must be
 * bounded here before it is formatted into a report pointer via
 * `./redact-pointer.ts`/`../invariant/pointer.ts`'s `formatPointer`, exactly like an
 * Ajv `instancePath` segment already is.
 */
export function boundCandidateSegment(segment: string): string {
  return segment.length > MAX_SEGMENT_LENGTH
    ? `${segment.slice(0, MAX_SEGMENT_LENGTH)}${TRUNCATION_MARKER}`
    : segment;
}
