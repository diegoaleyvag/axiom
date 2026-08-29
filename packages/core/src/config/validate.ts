import type { ValidateFunction } from 'ajv/dist/2020.js';
import type { AxiomConfigFileV1 } from '../domain/config.js';
import type { JsonValue } from '../domain/json.js';
import { ConfigError } from '../errors.js';
import { DEFAULT_LIMITS } from '../limits.js';
import { createAjv } from '../schema/ajv-factory.js';
// A static import (rather than a `readFileSync`/`import.meta.url` runtime lookup) so the
// schema is a normal module dependency: correct under plain Node ESM (CLI, Vitest) *and*
// statically inlinable by a bundler (the Action adapter's esbuild bundle), with no
// dependency on the `schemas/` directory being reachable at any particular relative depth
// from wherever this module ends up executing from.
import configSchema from '../../../../schemas/axiom-config.v1.schema.json' with { type: 'json' };

let cachedValidator: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!cachedValidator) {
    const ajv = createAjv({ maxPatternLength: DEFAULT_LIMITS.maxPatternLength });
    cachedValidator = ajv.compile(configSchema);
  }
  return cachedValidator;
}

/**
 * Validates a decoded config value against `schemas/axiom-config.v1.schema.json` (unknown
 * keys, wrong types, unsupported `version`, out-of-range numeric limits, ...).
 *
 * Deliberately does not encode Ajv's `data`/`params` (which can echo back the offending
 * value) into the thrown error's message -- only the safe `instancePath` and `message`
 * are used, with the full `validate.errors` array preserved as `cause` for developer
 * diagnostics, never rendered directly. Throws {@link ConfigError} on any violation.
 */
export function validateConfigShape(value: JsonValue): AxiomConfigFileV1 {
  const validate = getValidator();
  if (!validate(value)) {
    const [firstError] = validate.errors ?? [];
    const location =
      firstError?.instancePath && firstError.instancePath.length > 0
        ? firstError.instancePath
        : '(root)';
    const detail = firstError ? `${location} ${firstError.message ?? 'is invalid'}` : 'is invalid';
    throw new ConfigError(
      'config.schema-violation',
      `Config does not match axiom-config.v1: ${detail}`,
      validate.errors,
    );
  }
  return value as unknown as AxiomConfigFileV1;
}
