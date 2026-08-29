import path from 'node:path';
import type { ParsedArgs } from './argv.js';
import { stringOption } from './argv.js';

const DEFAULT_CONFIG_FILENAME = 'axiom.config.yaml';

/** Resolves `--config <path>` against the current working directory, defaulting to `./axiom.config.yaml`. */
export function resolveConfigPath(parsed: ParsedArgs): string {
  return path.resolve(stringOption(parsed, 'config') ?? DEFAULT_CONFIG_FILENAME);
}
