import type { AxiomReportV1 } from '../../domain/report.js';

/** C0 control characters and DEL, excluding tab (kept, then collapsed by the newline pass below). */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Hard cap on any single rendered cell so one pathological field cannot blow up the report. */
const MAX_CELL_LENGTH = 2048;
const CELL_TRUNCATION_MARKER = '\u2026(truncated)';

/**
 * Escapes a cell that may echo candidate-influenced text (e.g. a redaction-aware pointer,
 * a schema-derived `code`) so it can never break out of the Markdown table it is rendered
 * into, inject Markdown/HTML structure, or smuggle control/formatting characters into a
 * terminal or rendered summary:
 *
 * - Backslash first (so later escapes are not themselves re-escaped), then the table
 *   delimiter `|` and inline-code delimiter `` ` ``.
 * - `<`/`>` are entity-escaped so a candidate-influenced string can never be interpreted as
 *   raw HTML by a renderer that treats Markdown as HTML-embeddable (as GitHub's job summary
 *   and PR/issue rendering both do).
 * - All C0/DEL control characters and every newline are stripped/collapsed to a single
 *   space, so a candidate value can never inject an ANSI escape sequence into a terminal
 *   that later `cat`s a report, nor add rows/lines to a table cell.
 * - The result is length-capped independently of any upstream field-length limit, since
 *   this function is the last point before rendering, not the first point of validation.
 */
function cell(text: string | number | null | undefined): string {
  if (text === null || text === undefined) return '';
  const escaped = String(text)
    .replace(CONTROL_CHARS, '')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.length > MAX_CELL_LENGTH
    ? `${escaped.slice(0, MAX_CELL_LENGTH)}${CELL_TRUNCATION_MARKER}`
    : escaped;
}

/**
 * Renders a report as deterministic Markdown: fixed section order, fixed table columns,
 * every cell escaped against Markdown table syntax. Every string value rendered here has
 * already passed through the value-free report model, per-finding redaction-aware pointer
 * construction, and the defensive final redaction pass (`../redact-report.ts`) -- this
 * module only formats, it does not decide what is safe to show.
 */
export function renderReportMarkdown(report: AxiomReportV1): string {
  const lines: string[] = [];

  lines.push('# Axiom Report', '');
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Exit code: ${report.exitCode}`);
  lines.push(`- Tool version: ${cell(report.toolVersion)}`);
  lines.push(`- Config fingerprint: \`${cell(report.configFingerprint)}\``);
  lines.push(`- Population fingerprint: \`${cell(report.populationFingerprint)}\``);
  lines.push('');

  lines.push('## Checks', '');
  lines.push('| Check | Contract | Status | Findings |');
  lines.push('| --- | --- | --- | --- |');
  for (const check of report.checks) {
    lines.push(
      `| ${cell(check.checkId)} | ${cell(check.contractId)} | ${cell(check.status)} | ${check.findings.length} |`,
    );
  }
  lines.push('');

  const findings = report.checks.flatMap((check) => check.findings);
  if (findings.length > 0) {
    lines.push('## Findings', '');
    lines.push('| Check | Case | Attempt | Category | Code | Rule | Pointer |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const finding of findings) {
      lines.push(
        `| ${cell(finding.checkId)} | ${cell(finding.caseId)} | ${finding.attempt} | ${cell(finding.category)} | ${cell(finding.code)} | ${cell(finding.ruleId)} | ${cell(finding.pointer)} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Metrics', '');
  lines.push('| Metric | Numerator | Denominator | Value |');
  lines.push('| --- | --- | --- | --- |');
  for (const metric of report.metrics) {
    lines.push(
      `| ${cell(metric.id)} | ${metric.numerator} | ${metric.denominator} | ${cell(metric.value ?? 'n/a')} |`,
    );
  }
  lines.push('');

  if (report.comparison) {
    lines.push('## Comparison', '');
    lines.push(`- Baseline report: \`${cell(report.comparison.baselineReportPath)}\``);
    lines.push(`- Population: ${cell(report.comparison.population)}`);
    lines.push('');
    lines.push('| Metric | Direction | Amount | Current | Baseline | Result |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const threshold of report.comparison.thresholds) {
      lines.push(
        `| ${cell(threshold.metric)} | ${cell(threshold.direction)} | ${cell(threshold.amount)} | ${cell(threshold.current.value ?? 'n/a')} | ${cell(threshold.baseline.value ?? 'n/a')} | ${cell(threshold.result)} |`,
      );
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
