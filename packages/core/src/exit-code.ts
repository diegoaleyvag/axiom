import { AxiomError } from './errors.js';

/**
 * The complete, stable exit-code contract for the `axiom` CLI and the bundled Action:
 *
 * - `SUCCESS` (0): help/version, or a check whose required contracts/regressions passed.
 * - `CONTRACT_FAILURE` (1): a candidate/JSON/schema/invariant/policy/retry/regression
 *   finding. This is a normal *outcome*, decided by the evaluation engine (not yet
 *   implemented), never thrown as an exception.
 * - `INVALID_INPUT` (2): invalid configuration, invocation, input envelope, or schema --
 *   i.e. any {@link ConfigError}, {@link InputEnvelopeError}, or {@link BoundsError}.
 * - `INTERNAL_FAILURE` (3): I/O, spawn, timeout, output-overflow, or any unanticipated
 *   failure -- i.e. any {@link InternalError}, or a thrown value that is not an
 *   {@link AxiomError} at all.
 *
 * Uncaught exceptions and unhandled rejections must be routed through
 * {@link exitCodeForError} at the process boundary so a genuine crash always resolves to
 * `INTERNAL_FAILURE`, never `CONTRACT_FAILURE` -- see the ADR-worthy trap in the plan's
 * cross-review: Node's default crash behavior otherwise collides with "violations found".
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  CONTRACT_FAILURE: 1,
  INVALID_INPUT: 2,
  INTERNAL_FAILURE: 3,
} as const satisfies Record<string, ExitCode>;

export type ExitCode = 0 | 1 | 2 | 3;

/**
 * Classify any thrown value into the pinned exit-code contract. Anticipated
 * {@link AxiomError} subclasses report their own `exitCode` (2 or 3); everything else
 * (native errors, non-Error throwables, programming mistakes) maps to `INTERNAL_FAILURE`
 * so it can never be confused with a contract finding.
 */
export function exitCodeForError(error: unknown): ExitCode {
  if (error instanceof AxiomError) {
    return error.exitCode;
  }
  return EXIT_CODES.INTERNAL_FAILURE;
}
