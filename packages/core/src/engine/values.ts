import type { JsonValue } from '../domain/json.js';

/**
 * Sentinel representing "no value at this location" -- distinct from JSON `null`, which is
 * itself a present value. Every {@link Expr} interpreter function in this directory is
 * total over any bounded document and must return this sentinel instead of throwing when a
 * path/selector segment does not resolve, so a missing field always fails an invariant
 * closed rather than crashing evaluation (see `./invariant-eval.ts`).
 */
export const MISSING: unique symbol = Symbol('axiom.missing');

export type EvalValue = JsonValue | typeof MISSING;

export function isMissing(value: EvalValue): value is typeof MISSING {
  return value === MISSING;
}
