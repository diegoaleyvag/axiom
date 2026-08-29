import { ConfigError } from '@axiom/core';

export interface ParsedArgs {
  readonly command: string | undefined;
  readonly options: ReadonlyMap<string, string | true>;
  readonly positionals: readonly string[];
}

const FLAG_OPTIONS: ReadonlySet<string> = new Set(['allow-command', 'help', 'version']);

/**
 * Minimal, dependency-free `argv` parser: `axiom <command> [--flag] [--option value] [positionals...]`.
 * Every unrecognized shape is an invalid-invocation problem, thrown as {@link ConfigError}
 * (exit `2`) rather than a crash -- this is a normal CLI usage error, not tooling failure.
 */
export function parseArgv(argv: readonly string[]): ParsedArgs {
  const options = new Map<string, string | true>();
  const positionals: string[] = [];
  let command: string | undefined;

  let index = 0;
  while (index < argv.length) {
    const token = argv[index] as string;
    if (token === '-h') {
      options.set('help', true);
    } else if (token === '-v') {
      options.set('version', true);
    } else if (token.startsWith('--')) {
      const name = token.slice(2);
      if (name.length === 0) {
        throw new ConfigError('config.invalid-invocation', 'Encountered an empty "--" option.');
      }
      if (FLAG_OPTIONS.has(name)) {
        options.set(name, true);
      } else {
        const value = argv[index + 1];
        if (value === undefined) {
          throw new ConfigError(
            'config.invalid-invocation',
            `Option "--${name}" requires a value.`,
          );
        }
        options.set(name, value);
        index += 1;
      }
    } else if (command === undefined) {
      command = token;
    } else {
      positionals.push(token);
    }
    index += 1;
  }

  return { command, options, positionals };
}

export function stringOption(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.options.get(name);
  return typeof value === 'string' ? value : undefined;
}

export function flagOption(parsed: ParsedArgs, name: string): boolean {
  return parsed.options.get(name) === true;
}
