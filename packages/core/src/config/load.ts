import path from 'node:path';
import type { CompiledAxiomConfig } from '../domain/compiled-config.js';
import { ConfigError, InternalError } from '../errors.js';
import { DEFAULT_LIMITS } from '../limits.js';
import { isEnoentError } from '../runtime/node-filesystem.js';
import type { FileSystemPort } from '../runtime/ports.js';
import { compileConfig } from './compile.js';
import { decodeBoundedYaml } from './decode.js';
import { validateConfigShape } from './validate.js';

export interface LoadConfigOptions {
  readonly fs: FileSystemPort;
  readonly configPath: string;
}

/**
 * The single public entrypoint for turning a path to `axiom.config.yaml` into a
 * {@link CompiledAxiomConfig}, enforcing the plan's phase order end to end:
 *
 * 1. Read *only* the bounded config file through the injected {@link FileSystemPort}.
 * 2. Decode it as bounded YAML 1.2 (`./decode.js`).
 * 3. Validate its structure against `axiom-config.v1.schema.json` (`./validate.js`).
 * 4. Semantically compile it -- syntactic path resolution only, no I/O (`./compile.js`).
 *
 * Nothing here reads a referenced schema/artifact/baseline file or spawns a process: that
 * is the evaluation engine's job (implemented later), which must not begin until this
 * function has returned successfully. This ordering is what makes "an invalid config
 * performs no referenced-file access, report write, or process spawn" a checkable
 * property -- see `packages/core/test/config/phase-order.test.ts`, which asserts a spy
 * {@link FileSystemPort} only ever observes one `readFile` call (the config itself) no
 * matter how the config is invalid.
 */
export async function loadConfig(options: LoadConfigOptions): Promise<CompiledAxiomConfig> {
  const absoluteConfigPath = path.resolve(options.configPath);
  let text: string;
  try {
    text = await options.fs.readFile(absoluteConfigPath, {
      maxBytes: DEFAULT_LIMITS.maxConfigBytes,
    });
  } catch (error) {
    // A missing/unreadable `--config` target is an invalid-invocation problem (exit `2`),
    // not tooling failure (exit `3`) -- reclassified here, the one place `loadConfig` itself
    // touches the filesystem, rather than in the generic `FileSystemPort`, which intentionally
    // does not guess caller context (see `../runtime/node-filesystem.ts`).
    if (error instanceof InternalError && isEnoentError(error.cause)) {
      throw new ConfigError(
        'config.not-found',
        `Config file "${absoluteConfigPath}" does not exist.`,
        error,
      );
    }
    throw error;
  }
  const decoded = decodeBoundedYaml(text, {
    maxBytes: DEFAULT_LIMITS.maxConfigBytes,
    maxDepth: DEFAULT_LIMITS.maxJsonDepth,
    maxNodes: DEFAULT_LIMITS.maxJsonNodes,
  });
  const validated = validateConfigShape(decoded);
  return compileConfig(validated, absoluteConfigPath);
}
