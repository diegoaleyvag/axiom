/**
 * Typed error taxonomy shared by every core module.
 *
 * Every error that can be *anticipated* (bad config, bad input envelope, path/tooling
 * failures) extends {@link AxiomError} and carries a stable machine-readable `code` plus a
 * pinned `exitCode`. Anything that does NOT extend {@link AxiomError} (a genuine
 * programming mistake, a native exception, ...) is treated as unexpected and must map to
 * exit code 3 -- never 1 -- so an internal crash can never be mistaken for a contract
 * finding. See {@link exitCodeForError} in `./exit-code.js`.
 *
 * `message` is developer-facing only. Nothing in this module renders `cause`/`message`
 * into reports, annotations, or logs without going through the redaction pipeline first.
 */

export type AxiomErrorExitCode = 2 | 3;

export abstract class AxiomError extends Error {
  /** Stable, dot/slash-free machine-readable identifier, e.g. `"config.unknown-key"`. */
  abstract readonly code: string;
  /** Every anticipated error is either an invalid-input class (2) or a tooling class (3). */
  abstract readonly exitCode: AxiomErrorExitCode;

  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = this.constructor.name;
  }
}

/**
 * Invalid or unsupported `axiom.config.yaml`: parse failure, unknown/duplicate keys,
 * unsafe YAML constructs, schema violations, unsupported `version`, unresolved
 * cross-references, or a configured path that escapes the config root.
 */
export class ConfigError extends AxiomError {
  readonly exitCode = 2 as const;
  constructor(
    readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

/**
 * A structurally invalid input envelope: a malformed artifact/baseline/report JSON
 * document, duplicate keys, an unsupported `artifactVersion`/`reportVersion`, or a value
 * that violates the versioned artifact/report schema. This is distinct from a candidate
 * attempt whose *content* fails to parse as JSON -- that is a contract finding (exit 1),
 * evaluated later by the engine, not an `AxiomError`.
 */
export class InputEnvelopeError extends AxiomError {
  readonly exitCode = 2 as const;
  constructor(
    readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

/**
 * A safe-primitive bound was exceeded (byte/depth/node/pattern-length/attempt/finding
 * caps) or a path/pattern was rejected on security grounds. Modeled as invalid input (2)
 * because it is always caused by the config or the data it references, never by tooling.
 */
export class BoundsError extends AxiomError {
  readonly exitCode = 2 as const;
  constructor(
    readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

/**
 * I/O, spawn, timeout, output-overflow, or other unexpected tooling failure. Also the
 * fallback classification for any non-`AxiomError` throwable (see
 * {@link exitCodeForError}), so a genuine bug can never present as exit `1`.
 */
export class InternalError extends AxiomError {
  readonly exitCode = 3 as const;
  constructor(
    readonly code: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

export function isAxiomError(value: unknown): value is AxiomError {
  return value instanceof AxiomError;
}
