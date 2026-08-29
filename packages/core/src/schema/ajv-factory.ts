import { Ajv2020 } from 'ajv/dist/2020.js';
import ajvFormatsDefault from 'ajv-formats';
import { createAjvRegExpEngine } from './regex-engine.js';

export interface AjvFactoryOptions {
  /** Hard cap on pattern source length for every `pattern`/`patternProperties` keyword. */
  readonly maxPatternLength: number;
}

// `ajv-formats` ships a hand-authored ESM-style `.d.ts` (`export default formatsPlugin`)
// alongside a plain CommonJS build. Under `moduleResolution: NodeNext`, TypeScript's
// interop synthesis for a CommonJS-implied module models a default import as the whole
// module namespace rather than the declared default export type, so the import above
// type-checks as non-callable even though it is callable at runtime (`module.exports` IS
// the plugin function). Asserting the narrow shape actually used here avoids depending on
// that resolution quirk without weakening any other type in this module.
type AddFormatsFn = (ajv: Ajv2020) => void;
const addFormats = ajvFormatsDefault as unknown as AddFormatsFn;

/**
 * Builds one strict, offline, non-mutating Ajv 2020-12 instance shared by every schema
 * compiled in-process (the config schema now; contract/report schemas once the
 * evaluation engine exists).
 *
 * Hardening applied uniformly:
 *
 * - `strict: true` -- unknown keywords/formats and other silently-ignored JSON Schema
 *   footguns throw at compile time instead of passing data they should reject.
 * - `allErrors: true` -- every violation is collected (still redacted before it can reach
 *   a report; see `../redaction/redact.js`), not just the first.
 * - `validateFormats: true` with `ajv-formats` registered -- `format` is asserted, not
 *   merely annotated (Ajv ships no formats by default).
 * - No `$data` references, no `loadSchema` -- schema compilation can never trigger a
 *   network fetch, keeping normal runs fully offline.
 * - `code.regExp` routes every compiled pattern through the bounded RE2 adapter instead
 *   of native backtracking `RegExp`.
 * - `removeAdditional`/`useDefaults`/`coerceTypes` all stay at their `false` defaults: this
 *   validator only ever reports on data, it never mutates it.
 */
export function createAjv(options: AjvFactoryOptions): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    validateFormats: true,
    $data: false,
    removeAdditional: false,
    useDefaults: false,
    coerceTypes: false,
    code: {
      regExp: createAjvRegExpEngine({ maxPatternLength: options.maxPatternLength }),
    },
  });
  addFormats(ajv);
  return ajv;
}
