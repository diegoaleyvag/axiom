import { assertRealPathContained } from '../config/paths.js';
import type { CompiledAxiomConfig } from '../domain/compiled-config.js';
import type { AxiomReportV1, ComparisonReport } from '../domain/report.js';
import { ConfigError } from '../errors.js';
import { decodeBoundedJson } from '../json/decode.js';
import { DEFAULT_LIMITS } from '../limits.js';
import type { FileSystemPort, ProcessPort } from '../runtime/ports.js';
import { assertPopulationCompatible, compareThresholds } from './compare.js';
import { computeConfigFingerprint, computePopulationFingerprint } from './fingerprint.js';
import { buildReport } from './build-report.js';
import { redactReportDefensively } from './redact-report.js';
import { renderReportJson } from './render/json.js';
import { renderReportMarkdown } from './render/markdown.js';
import { runAllChecks, type RunConfigOptions } from './run-config.js';
import { validateReportShape } from './validate-report.js';

/**
 * Writes a report's canonical JSON and Markdown renderings to the config's configured
 * `reports.json`/`reports.markdown` paths. This is the single write path shared by every
 * command/adapter that produces or re-renders a report (CLI `check`/`compare`/`report`,
 * and the Action's `check`/`compare` modes), so none of them duplicates the containment
 * check, redaction pass, or rendering call -- the plan's "the later Action adapter has no
 * alternate path" applies here as much as to evaluation itself.
 */
export async function writeReportOutputs(
  fs: FileSystemPort,
  compiled: CompiledAxiomConfig,
  report: AxiomReportV1,
): Promise<void> {
  const redacted = redactReportDefensively(report, compiled.redaction.patterns);

  await assertRealPathContained(fs, compiled.configDir, compiled.reports.jsonPath, {
    mustExist: false,
  });
  await assertRealPathContained(fs, compiled.configDir, compiled.reports.markdownPath, {
    mustExist: false,
  });

  await fs.writeFile(compiled.reports.jsonPath, renderReportJson(redacted), { noClobber: false });
  await fs.writeFile(compiled.reports.markdownPath, renderReportMarkdown(redacted), {
    noClobber: false,
  });
}

/**
 * Evaluates every configured check against the current input and assembles the resulting
 * (not-yet-written) {@link AxiomReportV1} -- the shared core of both `axiom check` and
 * `axiom compare` (and their Action-mode equivalents), which differ only in whether a
 * baseline comparison is layered on top.
 */
async function evaluateCurrentReport(
  fs: FileSystemPort,
  processPort: ProcessPort,
  compiled: CompiledAxiomConfig,
  options: RunConfigOptions,
): Promise<AxiomReportV1> {
  const { checkReports, metrics, caseIdsByCheck } = await runAllChecks(
    fs,
    processPort,
    compiled,
    options,
  );
  const configFingerprint = await computeConfigFingerprint(fs, compiled);
  const populationFingerprint = computePopulationFingerprint(caseIdsByCheck);
  return buildReport({
    configFingerprint,
    populationFingerprint,
    checks: checkReports,
    metrics,
  });
}

/**
 * The complete `axiom check` workflow: evaluate the current input, write the configured
 * report outputs, and return the resulting report. Shared verbatim by the CLI's `check`
 * command and the Action's `check` mode.
 */
export async function runCheckWorkflow(
  fs: FileSystemPort,
  processPort: ProcessPort,
  compiled: CompiledAxiomConfig,
  options: RunConfigOptions,
): Promise<AxiomReportV1> {
  const report = await evaluateCurrentReport(fs, processPort, compiled, options);
  await writeReportOutputs(fs, compiled, report);
  return report;
}

/**
 * The complete `axiom compare` workflow: evaluate the current input with the same engine
 * as `runCheckWorkflow`, load and schema-validate the configured baseline *report*,
 * enforce population compatibility, evaluate every configured threshold, write the
 * configured report outputs (now carrying the comparison evidence), and return the
 * resulting report. Shared verbatim by the CLI's `compare` command and the Action's
 * `compare` mode. Throws {@link ConfigError} up front if the config has no `baseline`
 * section, before any check is evaluated.
 */
export async function runCompareWorkflow(
  fs: FileSystemPort,
  processPort: ProcessPort,
  compiled: CompiledAxiomConfig,
  options: RunConfigOptions,
): Promise<AxiomReportV1> {
  const baseline = compiled.baseline;
  if (!baseline) {
    throw new ConfigError(
      'config.no-baseline',
      'axiom compare requires a "baseline" section in the config.',
    );
  }

  const currentReport = await evaluateCurrentReport(fs, processPort, compiled, options);

  await assertRealPathContained(fs, compiled.configDir, baseline.reportPath, {
    mustExist: true,
  });
  const baselineText = await fs.readFile(baseline.reportPath, {
    maxBytes: DEFAULT_LIMITS.maxArtifactBytes,
  });
  const baselineDecoded = decodeBoundedJson(baselineText, {
    maxBytes: DEFAULT_LIMITS.maxArtifactBytes,
    maxDepth: DEFAULT_LIMITS.maxJsonDepth,
    maxNodes: DEFAULT_LIMITS.maxJsonNodes,
  });
  const baselineReport = validateReportShape(baselineDecoded);

  assertPopulationCompatible(currentReport, baselineReport, baseline.population);
  const thresholds = compareThresholds(currentReport, baselineReport, baseline.thresholds);
  const comparison: ComparisonReport = {
    // The config-relative form, not `baseline.reportPath` (an absolute, machine-specific
    // filesystem path) -- see `CompiledBaseline.reportPathRelative`'s doc comment.
    baselineReportPath: baseline.reportPathRelative,
    population: baseline.population,
    thresholds,
  };

  const finalReport = buildReport({
    configFingerprint: currentReport.configFingerprint,
    populationFingerprint: currentReport.populationFingerprint,
    checks: currentReport.checks,
    metrics: currentReport.metrics,
    comparison,
  });

  await writeReportOutputs(fs, compiled, finalReport);
  return finalReport;
}
