import { assertRealPathContained } from '../config/paths.js';
import type { CompiledAxiomConfig } from '../domain/compiled-config.js';
import type { CheckReport, Metric } from '../domain/report.js';
import { ConfigError, InternalError } from '../errors.js';
import type { FileSystemPort, ProcessPort } from '../runtime/ports.js';
import { computeMetrics } from './metrics.js';
import type { CaseOutcome } from './run-case.js';
import { runCheck } from './run-check.js';
import { createSchemaValidatorCache } from './schema-cache.js';

export interface RunConfigOptions {
  /** Mirrors the CLI's `--allow-command` flag / the Action's `allow-command: true` input. */
  readonly allowCommand: boolean;
}

export interface RunConfigResult {
  readonly checkReports: readonly CheckReport[];
  readonly metrics: readonly Metric[];
  readonly caseIdsByCheck: ReadonlyMap<string, readonly string[]>;
}

/**
 * Verifies real-path/symlink containment (see `../config/paths.ts`'s
 * `assertRealPathContained`) for every schema and artifact file a run is about to read,
 * *before* any of them is actually opened. `compileConfig` only ever syntactically resolves
 * these paths (no I/O, so a symlink cannot yet have been consulted); this is the I/O-touching
 * check that must run once a real filesystem is available, closing the gap a symlink planted
 * after config compilation but before evaluation could otherwise exploit to escape
 * `compiled.configDir`. Kept as one up-front pass (rather than inlined into
 * `./schema-cache.ts`/`./sources/artifact-source.ts`) so every referenced path for the whole
 * run is verified before any of them is trusted, matching how `./workflow.ts` already
 * verifies the configured baseline report path before reading it.
 */
async function assertReferencedInputPathsContained(
  fs: FileSystemPort,
  compiled: CompiledAxiomConfig,
): Promise<void> {
  for (const contract of compiled.contracts.values()) {
    await assertRealPathContained(fs, compiled.configDir, contract.schemaRootPath, {
      mustExist: true,
    });
    for (const resourcePath of contract.schemaResourcePaths) {
      await assertRealPathContained(fs, compiled.configDir, resourcePath, { mustExist: true });
    }
  }
  for (const check of compiled.checks.values()) {
    if (check.source.kind !== 'artifacts') continue;
    for (const item of check.source.items) {
      await assertRealPathContained(fs, compiled.configDir, item.path, { mustExist: true });
    }
  }
}

/**
 * Runs every configured check against `compiled` -- the single entrypoint shared by `axiom
 * check` and `axiom compare` (and, later, the Action adapter), so no adapter ever
 * reimplements check orchestration. Requires `options.allowCommand` up front for *every*
 * command-source check before running any of them, rather than failing partway through a
 * run after some checks already produced side effects.
 */
export async function runAllChecks(
  fs: FileSystemPort,
  processPort: ProcessPort,
  compiled: CompiledAxiomConfig,
  options: RunConfigOptions,
): Promise<RunConfigResult> {
  for (const check of compiled.checks.values()) {
    if (check.source.kind === 'command' && !options.allowCommand) {
      throw new ConfigError(
        'config.command-not-allowed',
        `Check "${check.id}" uses a command source, which requires explicit consent (--allow-command locally, or "allow-command: true" in the Action).`,
      );
    }
  }

  await assertReferencedInputPathsContained(fs, compiled);

  const schemaCache = createSchemaValidatorCache();
  const checkReports: CheckReport[] = [];
  const caseOutcomesByCheck: (readonly CaseOutcome[])[] = [];
  const caseIdsByCheck = new Map<string, readonly string[]>();

  for (const check of compiled.checks.values()) {
    const contract = compiled.contracts.get(check.contractId);
    if (!contract) {
      // compileConfig already rejects any check referencing an unknown contract, so this is
      // only reachable if a caller hand-assembles a CompiledAxiomConfig; guarded defensively.
      throw new InternalError(
        'internal.unresolved-contract',
        `Check "${check.id}" references contract "${check.contractId}", which was not found in the compiled config.`,
      );
    }

    const { checkReport, caseOutcomes } = await runCheck(
      fs,
      processPort,
      schemaCache,
      check,
      contract,
      compiled.redaction,
    );
    checkReports.push(checkReport);
    caseOutcomesByCheck.push(caseOutcomes);
    caseIdsByCheck.set(
      check.id,
      caseOutcomes.map((outcome) => outcome.caseId),
    );
  }

  return {
    checkReports,
    metrics: computeMetrics(caseOutcomesByCheck),
    caseIdsByCheck,
  };
}
