/**
 * One provider-neutral case to evaluate: an ordered list of raw attempt content strings.
 * Produced uniformly by every source (`./sources/artifact-source.ts`,
 * `./sources/command-source.ts`) regardless of whether the attempts were replayed from a
 * recorded envelope or just executed live, so `./run-check.ts`'s retry loop and metrics
 * aggregation never need to know which.
 */
export interface EngineCase {
  readonly caseId: string;
  readonly attempts: readonly string[];
}
