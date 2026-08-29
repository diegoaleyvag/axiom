import type { Finding } from '../domain/report.js';
import type { AttemptEvaluation } from './evaluate-attempt.js';

export interface AttemptOutcome {
  readonly attempt: number;
  readonly findings: readonly Finding[];
  readonly passed: boolean;
}

export interface CaseOutcome {
  readonly caseId: string;
  readonly attempts: readonly AttemptOutcome[];
  readonly passed: boolean;
  readonly attemptsUsed: number;
  readonly firstAttemptPassed: boolean;
}

/**
 * Runs one case's attempts in order -- from either a fully materialized list (artifact
 * sources) or an on-demand generator that spawns a live command per call (command sources,
 * see `./sources/command-source.ts`) -- stopping at the first attempt that passes evaluation
 * or once `maxAttempts` have been consumed. This one loop is the single place "retry
 * semantics" live: neither source implementation nor `./evaluate-attempt.ts` needs to know
 * about retries at all.
 */
export async function runCase(
  caseId: string,
  checkId: string,
  maxAttempts: number,
  getAttemptContent: (attemptIndex: number) => Promise<string>,
  evaluate: (content: string) => Promise<AttemptEvaluation>,
): Promise<CaseOutcome> {
  const attempts: AttemptOutcome[] = [];
  for (let index = 0; index < maxAttempts; index += 1) {
    const content = await getAttemptContent(index);
    const evaluation = await evaluate(content);
    const attemptNumber = index + 1;
    attempts.push({
      attempt: attemptNumber,
      passed: evaluation.passed,
      findings: evaluation.findings.map((finding) => ({
        ...finding,
        checkId,
        caseId,
        attempt: attemptNumber,
      })),
    });
    if (evaluation.passed) break;
  }

  const last = attempts.at(-1);
  return {
    caseId,
    attempts,
    passed: last?.passed ?? false,
    attemptsUsed: attempts.length,
    firstAttemptPassed: attempts[0]?.passed ?? false,
  };
}
