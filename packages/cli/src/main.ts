import { EXIT_CODES, exitCodeForError, isAxiomError, type ExitCode } from '@axiom/core';
import { parseArgv, flagOption } from './argv.js';
import { runInit } from './commands/init.js';
import { runCheck } from './commands/check.js';
import { runCompare } from './commands/compare.js';
import { runReport } from './commands/report.js';

const VERSION = '0.1.0';

const HELP_TEXT = `axiom -- offline, provider-neutral contract validation for structured AI outputs.

Usage:
  axiom init [configPath]              Create a starter config, schema, and example artifact.
  axiom check [--config path] [--allow-command]
                                        Evaluate the current input and write reports.
  axiom compare [--config path] [--allow-command]
                                        Evaluate current input and compare it to the configured baseline.
  axiom report --report path [--config path]
                                        Re-validate, redact, and re-render an existing report.

Options:
  --config <path>       Path to axiom.config.yaml (default: ./axiom.config.yaml).
  --allow-command        Consent to running a configured command source.
  --report <path>        Path to an existing axiom-report.v1 JSON file (for "report").
  -h, --help              Show this help.
  -v, --version            Show the tool version.

Exit codes:
  0  success (help/version, or a passing check/compare)
  1  a contract, quality, or regression finding
  2  invalid configuration, invocation, input envelope, or schema
  3  an I/O, spawn, timeout, overflow, or other unexpected failure
`;

/**
 * The CLI's single entrypoint: parses `argv`, dispatches to one command module, and maps
 * every outcome -- returned exit code or thrown error -- to the pinned `0/1/2/3` contract
 * (`../../packages/core/src/exit-code.ts`). This function never throws; it is the process
 * boundary the plan calls out where "Node's default crash behavior otherwise collides with
 * 'violations found'" must not be allowed to happen.
 */
export async function main(argv: readonly string[]): Promise<ExitCode> {
  try {
    const parsed = parseArgv(argv);

    if (flagOption(parsed, 'help')) {
      process.stdout.write(HELP_TEXT);
      return EXIT_CODES.SUCCESS;
    }
    if (flagOption(parsed, 'version')) {
      process.stdout.write(`${VERSION}\n`);
      return EXIT_CODES.SUCCESS;
    }

    switch (parsed.command) {
      case 'init':
        return await runInit(parsed);
      case 'check':
        return await runCheck(parsed);
      case 'compare':
        return await runCompare(parsed);
      case 'report':
        return await runReport(parsed);
      case undefined:
        process.stderr.write('axiom: missing command. Run "axiom --help" for usage.\n');
        return EXIT_CODES.INVALID_INPUT;
      default:
        process.stderr.write(
          `axiom: unknown command "${parsed.command}". Run "axiom --help" for usage.\n`,
        );
        return EXIT_CODES.INVALID_INPUT;
    }
  } catch (error) {
    if (isAxiomError(error)) {
      process.stderr.write(`axiom: ${error.code}: ${error.message}\n`);
    } else {
      process.stderr.write('axiom: internal error.\n');
    }
    return exitCodeForError(error);
  }
}
