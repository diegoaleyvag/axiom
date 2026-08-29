import type { CompiledCheck, CompiledContract } from '../domain/compiled-config.js';
import type { CheckReport, CheckStatus, Finding } from '../domain/report.js';
import type { FileSystemPort, ProcessPort } from '../runtime/ports.js';
import { evaluateAttempt } from './evaluate-attempt.js';
import type { RedactionSelectors } from './redact-pointer.js';
import type { CaseOutcome } from './run-case.js';
import { runCase } from './run-case.js';
import type { SchemaValidatorCache } from './schema-cache.js';
import { loadArtifactCases } from './sources/artifact-source.js';
import { createCommandAttemptSource } from './sources/command-source.js';

export interface CheckRunResult {
  readonly checkReport: CheckReport;
  readonly caseOutcomes: readonly CaseOutcome[];
}

/**
 * Runs one compiled check end to end: materializes its cases (an artifact source's items,
 * or the single live case a command source produces), runs the shared retry loop
 * (`./run-case.ts`) for each, and assembles the resulting {@link CheckReport}. Also records a
 * `retry` category finding when a multi-attempt case never passed despite exhausting its
 * configured budget -- distinct from, and in addition to, the per-attempt `json`/`schema`/
 * `invariant`/`policy` findings already attached to each attempt.
 */
export async function runCheck(
  fs: FileSystemPort,
  processPort: ProcessPort,
  schemaCache: SchemaValidatorCache,
  check: CompiledCheck,
  contract: CompiledContract,
  redaction: RedactionSelectors,
): Promise<CheckRunResult> {
  const evaluate = (content: string) =>
    evaluateAttempt(fs, schemaCache, contract, redaction, content);
  const caseOutcomes: CaseOutcome[] = [];
  // The *effective* per-case attempt cap actually offered to `runCase` -- which, for an
  // artifact source, is further clamped by how many recorded attempts that specific item
  // has (see below). A "retry.exhausted" finding is only meaningful when a case was ever
  // eligible for more than one attempt; otherwise it is indistinguishable from an ordinary
  // single-attempt failure and must not be reported as an exhausted *retry*.
  const effectiveMaxAttempts = new Map<string, number>();

  if (check.source.kind === 'artifacts') {
    const cases = await loadArtifactCases(fs, check.source);
    for (const engineCase of cases) {
      const maxAttempts = Math.min(check.retries.maxAttempts, engineCase.attempts.length);
      effectiveMaxAttempts.set(engineCase.caseId, maxAttempts);
      const outcome = await runCase(
        engineCase.caseId,
        check.id,
        maxAttempts,
        async (index) => engineCase.attempts[index] as string,
        evaluate,
      );
      caseOutcomes.push(outcome);
    }
  } else {
    const attemptSource = createCommandAttemptSource(processPort, check.source, check.retries);
    effectiveMaxAttempts.set(check.id, check.retries.maxAttempts);
    const outcome = await runCase(
      check.id,
      check.id,
      check.retries.maxAttempts,
      (index) => attemptSource.getAttemptContent(index),
      evaluate,
    );
    caseOutcomes.push(outcome);
  }

  const findings: Finding[] = [];
  for (const outcome of caseOutcomes) {
    for (const attempt of outcome.attempts) {
      findings.push(...attempt.findings);
    }
    const caseMaxAttempts = effectiveMaxAttempts.get(outcome.caseId) ?? 1;
    if (!outcome.passed && caseMaxAttempts > 1) {
      findings.push({
        code: 'retry.exhausted',
        category: 'retry',
        checkId: check.id,
        // `caseId` is always config-authored (an artifact item id, or the check id itself
        // for a command source) -- never candidate-derived -- so it needs no redaction.
        caseId: outcome.caseId,
        attempt: outcome.attemptsUsed,
      });
    }
  }

  const status: CheckStatus = caseOutcomes.every((outcome) => outcome.passed) ? 'pass' : 'fail';

  return {
    checkReport: { checkId: check.id, contractId: check.contractId, status, findings },
    caseOutcomes,
  };
}
