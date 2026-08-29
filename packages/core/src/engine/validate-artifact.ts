import type { ValidateFunction } from 'ajv/dist/2020.js';
import type { ArtifactEnvelopeV1 } from '../domain/artifact.js';
import type { JsonValue } from '../domain/json.js';
import { InputEnvelopeError } from '../errors.js';
import { DEFAULT_LIMITS } from '../limits.js';
import { createAjv } from '../schema/ajv-factory.js';
// A static import (rather than a `readFileSync`/`import.meta.url` runtime lookup) so the
// schema is a normal module dependency: correct under plain Node ESM (CLI, Vitest) *and*
// statically inlinable by a bundler (the Action adapter's esbuild bundle), with no
// dependency on the `schemas/` directory being reachable at any particular relative depth
// from wherever this module ends up executing from.
import artifactSchema from '../../../../schemas/axiom-artifact.v1.schema.json' with { type: 'json' };

let cachedValidator: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!cachedValidator) {
    const ajv = createAjv({ maxPatternLength: DEFAULT_LIMITS.maxPatternLength });
    cachedValidator = ajv.compile(artifactSchema);
  }
  return cachedValidator;
}

/**
 * Validates a decoded value against `schemas/axiom-artifact.v1.schema.json`. This is the
 * envelope-level check (exit `2` on violation) -- distinct from a candidate attempt's own
 * `content` failing to parse as JSON, which is a `json` category contract finding handled
 * entirely inside `./evaluate-attempt.ts` and never reaches here.
 */
export function validateArtifactEnvelope(value: JsonValue): ArtifactEnvelopeV1 {
  const validate = getValidator();
  if (!validate(value)) {
    const [firstError] = validate.errors ?? [];
    const location =
      firstError?.instancePath && firstError.instancePath.length > 0
        ? firstError.instancePath
        : '(root)';
    const detail = firstError ? `${location} ${firstError.message ?? 'is invalid'}` : 'is invalid';
    throw new InputEnvelopeError(
      'input.invalid-artifact-envelope',
      `Artifact envelope does not match axiom-artifact.v1: ${detail}`,
      validate.errors,
    );
  }
  return value as unknown as ArtifactEnvelopeV1;
}
