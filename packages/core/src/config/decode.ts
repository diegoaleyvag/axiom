import { parseDocument } from 'yaml';
import type { JsonValue } from '../domain/json.js';
import { BoundsError, ConfigError } from '../errors.js';
import { assertSafeObjectGraph } from '../json/safe-object.js';

export interface DecodeYamlOptions {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
}

/**
 * Decodes `axiom.config.yaml` text into a plain JSON-shaped value using YAML 1.2, with
 * every documented "reject this" clause from the plan enforced explicitly rather than
 * left to library defaults (even where a default already agrees, so this stays correct
 * if the dependency's defaults ever change):
 *
 * - `version: '1.2'`, `schema: 'core'` -- no YAML 1.1 autodetection surprises.
 * - `merge: false` -- `<<` merge keys are not a YAML 1.2 feature and are not re-enabled.
 * - `resolveKnownTags: false` -- no implicit `!!binary`/`!!omap`/`!!set`/`!!timestamp`
 *   fallback resolution; the config format only ever needs plain scalars/mappings/sequences.
 * - no `customTags` -- an explicit `!tag` the core schema does not know produces a
 *   warning, which is treated as a hard failure below.
 * - `uniqueKeys: true` -- duplicate mapping keys are a parse error, not last-wins.
 * - `maxAliasCount: 0` on `toJS()` -- rejects every anchor/alias node outright (not just
 *   merge-key usage), closing both the "billion laughs" memory-expansion vector and the
 *   more mundane confusion of two keys silently sharing one aliased value.
 *
 * Every parse warning (not just error) is escalated to a thrown {@link ConfigError}: a
 * config that only *unambiguously* parses is not good enough, since Axiom's guarantees
 * depend on config semantics being unambiguous too.
 */
export function decodeBoundedYaml(text: string, options: DecodeYamlOptions): JsonValue {
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > options.maxBytes) {
    throw new BoundsError(
      'bounds.max-bytes-exceeded',
      `Config is ${byteLength} bytes, exceeding the ${options.maxBytes} byte limit.`,
    );
  }

  let value: unknown;
  try {
    const document = parseDocument(text, {
      version: '1.2',
      schema: 'core',
      merge: false,
      resolveKnownTags: false,
      uniqueKeys: true,
      strict: true,
    });

    if (document.errors.length > 0) {
      throw new ConfigError(
        'config.invalid-yaml',
        `Config is not valid YAML: ${document.errors[0]?.message ?? 'unknown parse error'}`,
        document.errors,
      );
    }
    if (document.warnings.length > 0) {
      throw new ConfigError(
        'config.invalid-yaml',
        `Config uses an unsupported or ambiguous YAML construct: ${document.warnings[0]?.message ?? 'unknown warning'}`,
        document.warnings,
      );
    }

    value = document.toJS({ mapAsMap: false, maxAliasCount: 0 });
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    throw new ConfigError('config.invalid-yaml', 'Config could not be parsed as YAML 1.2.', error);
  }

  assertSafeObjectGraph(value, { maxDepth: options.maxDepth, maxNodes: options.maxNodes });
  return value as JsonValue;
}
