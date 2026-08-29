import path from 'node:path';
import * as core from '@actions/core';
import {
  ConfigError,
  createNodeFileSystem,
  createNodeProcess,
  exitCodeForError,
  isAxiomError,
  loadConfig,
  redactReportDefensively,
  renderReportMarkdown,
  runCheckWorkflow,
  runCompareWorkflow,
  type AxiomReportV1,
  type CompiledAxiomConfig,
  type ExitCode,
  type Finding,
} from '@axiom/core';

/**
 * Bounded so a pathological run (many findings, a huge report) can never flood the Action
 * log or job summary -- mirrors the plan's "cap annotations/summary bytes" requirement.
 * Findings beyond this count are still fully present in the written JSON/Markdown reports;
 * only the *annotation* stream is capped.
 */
const MAX_ANNOTATIONS = 20;
/** Hard byte cap on the job summary body, independent of how large the full report is. */
const MAX_SUMMARY_BYTES = 200_000;

type Mode = 'check' | 'compare';

function booleanInput(name: string, defaultValue: boolean): boolean {
  const raw = core.getInput(name);
  return raw === '' ? defaultValue : core.getBooleanInput(name);
}

function resolveMode(): Mode {
  const raw = core.getInput('mode') || 'check';
  if (raw !== 'check' && raw !== 'compare') {
    throw new ConfigError(
      'config.invalid-invocation',
      `The "mode" input must be "check" or "compare", got "${raw}".`,
    );
  }
  return raw;
}

/** Never includes a candidate value -- only stable IDs, codes, and a redaction-aware pointer. */
function formatFindingMessage(finding: Finding): string {
  const parts = [
    `check=${finding.checkId}`,
    `case=${finding.caseId}`,
    `attempt=${String(finding.attempt)}`,
    `category=${finding.category}`,
    `code=${finding.code}`,
  ];
  if (finding.ruleId !== undefined) parts.push(`rule=${finding.ruleId}`);
  if (finding.pointer !== undefined) parts.push(`pointer=${finding.pointer}`);
  return `axiom: ${parts.join(' ')}`;
}

function emitAnnotations(report: AxiomReportV1): void {
  const findings = report.checks.flatMap((check) => check.findings);
  const shown = findings.slice(0, MAX_ANNOTATIONS);
  for (const finding of shown) {
    const message = formatFindingMessage(finding);
    if (finding.category === 'retry') {
      core.warning(message);
    } else {
      core.error(message);
    }
  }
  const omitted = findings.length - shown.length;
  if (omitted > 0) {
    core.warning(`axiom: ${omitted} additional finding(s) omitted from annotations.`);
  }

  if (report.comparison) {
    for (const threshold of report.comparison.thresholds) {
      const message = `axiom: baseline threshold "${threshold.metric}" (${threshold.direction}) -- ${threshold.result}.`;
      if (threshold.result === 'fail') {
        core.error(message);
      } else if (threshold.result === 'insufficient-data') {
        core.warning(message);
      }
    }
  }

  if (report.status === 'pass') {
    core.notice(`axiom: pass (exit ${String(report.exitCode)}).`);
  }
}

/**
 * Writes the job summary from the same already-redacted report used for the JSON/Markdown
 * outputs, truncated to {@link MAX_SUMMARY_BYTES}. A no-op outside a real Actions runner
 * (no `GITHUB_STEP_SUMMARY` file), which is exactly the case in unit tests and local `act`
 * runs without summary support -- this must never throw just because that file is absent.
 */
async function writeSummary(report: AxiomReportV1): Promise<void> {
  if (!process.env['GITHUB_STEP_SUMMARY']) return;
  const markdown = renderReportMarkdown(report);
  const bounded =
    Buffer.byteLength(markdown, 'utf8') > MAX_SUMMARY_BYTES
      ? `${markdown.slice(0, MAX_SUMMARY_BYTES)}\n\n_(truncated)_\n`
      : markdown;
  core.summary.addRaw(bounded, true);
  await core.summary.write();
}

function setOutputs(compiled: CompiledAxiomConfig, report: AxiomReportV1): void {
  core.setOutput('status', report.status);
  core.setOutput('exit-code', String(report.exitCode));
  core.setOutput('report-json-path', compiled.reports.jsonPath);
  core.setOutput('report-markdown-path', compiled.reports.markdownPath);
}

/**
 * The Action's single entrypoint, run as a thin adapter over the exact same core workflow
 * functions the CLI uses (`runCheckWorkflow`/`runCompareWorkflow`) -- no validation,
 * evaluation, comparison, or report-writing logic is reimplemented here. Uses `@actions/core`
 * only for escaped inputs/outputs/annotations/summary/failure signaling; requires no token
 * or provider SDK of any kind. Returns the real `0/1/2/3` axiom exit code for testability;
 * mapping that to the Actions runner's binary success/failure convention is the caller's
 * job (see `./main.ts`, the actual bundle entrypoint), since GitHub Actions itself has no
 * concept of exit codes 2 or 3 distinct from 1.
 */
export async function run(): Promise<ExitCode> {
  try {
    const workingDirectory = core.getInput('working-directory') || process.cwd();
    const configPath = path.resolve(
      workingDirectory,
      core.getInput('config-path') || 'axiom.config.yaml',
    );
    const mode = resolveMode();
    const allowCommand = booleanInput('allow-command', false);

    const fs = createNodeFileSystem();
    const processPort = createNodeProcess();
    const compiled = await loadConfig({ fs, configPath });

    const report =
      mode === 'check'
        ? await runCheckWorkflow(fs, processPort, compiled, { allowCommand })
        : await runCompareWorkflow(fs, processPort, compiled, { allowCommand });

    const redacted = redactReportDefensively(report, compiled.redaction.patterns);
    emitAnnotations(redacted);
    await writeSummary(redacted);
    setOutputs(compiled, redacted);

    return redacted.exitCode;
  } catch (error) {
    core.error(
      isAxiomError(error) ? `axiom: ${error.code}: ${error.message}` : 'axiom: internal error.',
    );
    const exitCode = exitCodeForError(error);
    // Set independently of `setOutputs` (which needs a `CompiledAxiomConfig` and a produced
    // report, neither of which exist on this path): every documented exit code (0/1/2/3),
    // not only a successful run's, must be readable from the "exit-code" output -- action.yml
    // documents it as covering all four, and the Action process itself only ever exits 0/1,
    // so this output is the *only* way a caller can distinguish "invalid config" (2) from "a
    // tooling failure" (3) short of parsing error text.
    core.setOutput('exit-code', String(exitCode));
    return exitCode;
  }
}
