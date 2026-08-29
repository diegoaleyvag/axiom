import type { ValidateFunction } from 'ajv/dist/2020.js';
import type { JsonValue } from '../domain/json.js';
import type { AxiomReportV1 } from '../domain/report.js';
import { InputEnvelopeError } from '../errors.js';
import { DEFAULT_LIMITS } from '../limits.js';
import { createAjv } from '../schema/ajv-factory.js';
// A static import (rather than a `readFileSync`/`import.meta.url` runtime lookup) so the
// schema is a normal module dependency: correct under plain Node ESM (CLI, Vitest) *and*
// statically inlinable by a bundler (the Action adapter's esbuild bundle), with no
// dependency on the `schemas/` directory being reachable at any particular relative depth
// from wherever this module ends up executing from.
import reportSchema from '../../../../schemas/axiom-report.v1.schema.json' with { type: 'json' };

let cachedValidator: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!cachedValidator) {
    const ajv = createAjv({ maxPatternLength: DEFAULT_LIMITS.maxPatternLength });
    cachedValidator = ajv.compile(reportSchema);
  }
  return cachedValidator;
}

/**
 * Validates a decoded value against `schemas/axiom-report.v1.schema.json`, used by `axiom
 * compare` (reading a configured baseline report) and `axiom report` (re-rendering an
 * existing report) -- both read a report file that was not necessarily just produced by
 * this same process, so it is revalidated rather than trusted.
 */
export function validateReportShape(value: JsonValue): AxiomReportV1 {
  const validate = getValidator();
  if (!validate(value)) {
    const [firstError] = validate.errors ?? [];
    const location =
      firstError?.instancePath && firstError.instancePath.length > 0
        ? firstError.instancePath
        : '(root)';
    const detail = firstError ? `${location} ${firstError.message ?? 'is invalid'}` : 'is invalid';
    throw new InputEnvelopeError(
      'input.invalid-report',
      `Report does not match axiom-report.v1: ${detail}`,
      validate.errors,
    );
  }
  return value as unknown as AxiomReportV1;
}
