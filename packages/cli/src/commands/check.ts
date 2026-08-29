import {
  createNodeFileSystem,
  createNodeProcess,
  loadConfig,
  runCheckWorkflow,
  type ExitCode,
} from '@axiom/core';
import { flagOption } from '../argv.js';
import type { ParsedArgs } from '../argv.js';
import { resolveConfigPath } from '../config-path.js';

/**
 * `axiom check`: compiles the config and delegates the entire evaluate-and-report workflow
 * to `@axiom/core`'s {@link runCheckWorkflow} -- the CLI adapter makes no decision of its
 * own here, only translates `argv` in and the report's own decision code out.
 */
export async function runCheck(parsed: ParsedArgs): Promise<ExitCode> {
  const configPath = resolveConfigPath(parsed);
  const fs = createNodeFileSystem();
  const processPort = createNodeProcess();

  const compiled = await loadConfig({ fs, configPath });
  const allowCommand = flagOption(parsed, 'allow-command');

  const report = await runCheckWorkflow(fs, processPort, compiled, { allowCommand });

  process.stdout.write(`axiom: ${report.status} (exit ${report.exitCode})\n`);
  return report.exitCode;
}
