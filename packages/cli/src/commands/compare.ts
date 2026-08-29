import {
  createNodeFileSystem,
  createNodeProcess,
  loadConfig,
  runCompareWorkflow,
  type ExitCode,
} from '@axiom/core';
import { flagOption } from '../argv.js';
import type { ParsedArgs } from '../argv.js';
import { resolveConfigPath } from '../config-path.js';

/**
 * `axiom compare`: compiles the config and delegates the entire evaluate-compare-and-report
 * workflow to `@axiom/core`'s {@link runCompareWorkflow} (freshly evaluating current input,
 * loading the configured baseline *report*, enforcing population compatibility, and
 * evaluating every configured threshold) -- the CLI adapter makes no decision of its own
 * here, only translates `argv` in and the report's own decision code out.
 */
export async function runCompare(parsed: ParsedArgs): Promise<ExitCode> {
  const configPath = resolveConfigPath(parsed);
  const fs = createNodeFileSystem();
  const processPort = createNodeProcess();

  const compiled = await loadConfig({ fs, configPath });
  const allowCommand = flagOption(parsed, 'allow-command');

  const report = await runCompareWorkflow(fs, processPort, compiled, { allowCommand });

  process.stdout.write(`axiom: ${report.status} (exit ${report.exitCode})\n`);
  return report.exitCode;
}
