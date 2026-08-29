/**
 * Compiled-in hard ceilings for every bounded primitive (byte sizes, JSON/expression
 * depth and node counts, pattern length, attempts, findings, ...).
 *
 * These are upper bounds the running binary enforces unconditionally. A config may
 * *lower* any corresponding limit (e.g. a smaller `maxStdoutBytes`) but can never raise it
 * past what is declared here -- see `config/compile.js`, which rejects any configured
 * value that exceeds its `DEFAULT_LIMITS` counterpart.
 */
export const DEFAULT_LIMITS = {
  /** Maximum byte size of `axiom.config.yaml` itself. */
  maxConfigBytes: 1 * 1024 * 1024,
  /** Maximum byte size of a single referenced JSON Schema file. */
  maxSchemaBytes: 2 * 1024 * 1024,
  /** Maximum combined byte size of all schema resources for one contract. */
  maxSchemaResourcesBytes: 8 * 1024 * 1024,
  /** Maximum byte size of one artifact/baseline/report JSON document. */
  maxArtifactBytes: 2 * 1024 * 1024,
  /** Maximum byte size of captured command stdout. */
  maxStdoutBytes: 2 * 1024 * 1024,
  /** Maximum byte size of captured command stderr. */
  maxStderrBytes: 64 * 1024,
  /** Maximum object/array nesting depth for any decoded JSON document. */
  maxJsonDepth: 64,
  /** Maximum total object-property + array-element nodes for any decoded JSON document. */
  maxJsonNodes: 100_000,
  /** Maximum RFC 6901 pointer/selector segment count. */
  maxPointerSegments: 32,
  /** Maximum length, in characters, of a single pointer/selector segment. */
  maxPointerSegmentLength: 256,
  /** Maximum `*` wildcard segments in one selector. */
  maxSelectorWildcards: 8,
  /** Maximum nesting depth of one invariant/policy expression tree. */
  maxExprDepth: 32,
  /** Maximum total node count of one invariant/policy expression tree. */
  maxExprNodes: 512,
  /** Maximum operand count in a single `all`/`any` expression. */
  maxExprOperands: 64,
  /** Maximum length, in characters, of any RE2 pattern (schema, policy, or redaction). */
  maxPatternLength: 512,
  /** Maximum permitted attempts for any single check's retry policy. */
  maxAttempts: 5,
  /** Maximum permitted command timeout. */
  maxCommandTimeoutMs: 300_000,
  /** Maximum permitted findings recorded in a single report (counters stay exact regardless). */
  maxFindings: 200,
} as const;

export type Limits = typeof DEFAULT_LIMITS;
