import { BoundsError, ConfigError } from '../errors.js';

export interface PointerLimits {
  readonly maxSegments: number;
  readonly maxSegmentLength: number;
}

export interface SelectorLimits extends PointerLimits {
  readonly maxWildcards: number;
}

export type SelectorSegment =
  { readonly kind: 'exact'; readonly key: string } | { readonly kind: 'wildcard' };

const ESCAPE_TOKEN_PATTERN = /~(?![01])/;

function unescapeToken(token: string, original: string): string {
  if (ESCAPE_TOKEN_PATTERN.test(token)) {
    throw new ConfigError(
      'config.invalid-pointer',
      `Pointer "${original}" has a "~" not followed by "0" or "1".`,
    );
  }
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function escapeToken(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

function splitReferenceTokens(raw: string, original: string): string[] {
  if (raw === '') {
    return [];
  }
  if (!raw.startsWith('/')) {
    throw new ConfigError(
      'config.invalid-pointer',
      `Pointer "${original}" must be empty (whole document) or start with "/".`,
    );
  }
  return raw.split('/').slice(1);
}

/**
 * Parses an exact RFC 6901 JSON Pointer into its ordered, unescaped reference tokens
 * (`""` means the whole document). Throws {@link ConfigError} on malformed escapes and
 * {@link BoundsError} if the pointer exceeds the configured segment-count/length caps.
 * Pure and total for any bounded string input -- never throws anything else.
 */
export function parsePointer(raw: string, limits: PointerLimits): readonly string[] {
  const tokens = splitReferenceTokens(raw, raw);
  if (tokens.length > limits.maxSegments) {
    throw new BoundsError(
      'bounds.pointer-too-deep',
      `Pointer "${raw}" has more than ${limits.maxSegments} segments.`,
    );
  }
  return tokens.map((token) => {
    if (token.length > limits.maxSegmentLength) {
      throw new BoundsError(
        'bounds.pointer-segment-too-long',
        `Pointer "${raw}" has a segment longer than ${limits.maxSegmentLength} characters.`,
      );
    }
    return unescapeToken(token, raw);
  });
}

/** Formats reference tokens back into an RFC 6901 pointer string (inverse of {@link parsePointer}). */
export function formatPointer(segments: readonly string[]): string {
  return segments.map((segment) => `/${escapeToken(segment)}`).join('');
}

/**
 * Parses a bounded selector: an exact RFC 6901 pointer where any single reference token
 * may additionally be the literal `*`, matching any one key/index at that position. There
 * is no multi-level (`**`) wildcard here -- that is reserved for the forbidden-path policy
 * grammar, a distinct, later, evaluation-time concern. Throws {@link BoundsError} if the
 * selector exceeds the segment, segment-length, or wildcard-count caps.
 */
export function parseSelector(raw: string, limits: SelectorLimits): readonly SelectorSegment[] {
  const tokens = splitReferenceTokens(raw, raw);
  if (tokens.length > limits.maxSegments) {
    throw new BoundsError(
      'bounds.selector-too-deep',
      `Selector "${raw}" has more than ${limits.maxSegments} segments.`,
    );
  }
  let wildcardCount = 0;
  return tokens.map((token) => {
    if (token === '*') {
      wildcardCount += 1;
      if (wildcardCount > limits.maxWildcards) {
        throw new BoundsError(
          'bounds.selector-too-many-wildcards',
          `Selector "${raw}" has more than ${limits.maxWildcards} wildcard segments.`,
        );
      }
      return { kind: 'wildcard' } as const;
    }
    if (token.length > limits.maxSegmentLength) {
      throw new BoundsError(
        'bounds.selector-segment-too-long',
        `Selector "${raw}" has a segment longer than ${limits.maxSegmentLength} characters.`,
      );
    }
    return { kind: 'exact', key: unescapeToken(token, raw) } as const;
  });
}
