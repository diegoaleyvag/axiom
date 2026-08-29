import {
  ConfigError,
  DEFAULT_LIMITS,
  createNodeFileSystem,
  decodeBoundedJson,
  loadConfig,
  validateReportShape,
  writeReportOutputs,
  type ExitCode,
} from '@axiom/core';
import { stringOption } from '../argv.js';
import type { ParsedArgs } from '../argv.js';
import { resolveConfigPath } from '../config-path.js';

/**
 * `axiom report --report <path>`: validates an existing canonical report file (which need
 * not have been produced by this process -- it is fully revalidated, never trusted),
 * defensively redacts it again using the config's redaction rules, deterministically
 * re-renders JSON/Markdown, and mirrors the report's own `exitCode` -- it never rereads
 * candidate artifacts or re-runs any check.
 */
export async function runReport(parsed: ParsedArgs): Promise<ExitCode> {
  const reportPathOption = stringOption(parsed, 'report');
  if (reportPathOption === undefined) {
    throw new ConfigError('config.invalid-invocation', 'axiom report requires --report <path>.');
  }

  const configPath = resolveConfigPath(parsed);
  const fs = createNodeFileSystem();
  const compiled = await loadConfig({ fs, configPath });

  const text = await fs.readFile(reportPathOption, { maxBytes: DEFAULT_LIMITS.maxArtifactBytes });
  const decoded = decodeBoundedJson(text, {
    maxBytes: DEFAULT_LIMITS.maxArtifactBytes,
    maxDepth: DEFAULT_LIMITS.maxJsonDepth,
    maxNodes: DEFAULT_LIMITS.maxJsonNodes,
  });
  const report = validateReportShape(decoded);

  await writeReportOutputs(fs, compiled, report);

  process.stdout.write(
    `axiom: mirrored report status ${report.status} (exit ${report.exitCode})\n`,
  );
  return report.exitCode;
}
