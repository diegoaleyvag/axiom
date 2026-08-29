import type { ErrorObject } from 'ajv/dist/2020.js';
import type { CompiledContract } from '../domain/compiled-config.js';
import type { JsonValue } from '../domain/json.js';
import { BoundsError, InputEnvelopeError } from '../errors.js';
import { decodeBoundedJson } from '../json/decode.js';
import { DEFAULT_LIMITS } from '../limits.js';
import type { FileSystemPort } from '../runtime/ports.js';
import { evaluateForbidden } from './policy.js';
import type { PartialFinding } from './finding.js';
import { evaluateInvariant } from './invariant-eval.js';
import { redactPointerSegments, type RedactionSelectors } from './redact-pointer.js';
import { safeParsePointerSegments } from './safe-pointer.js';
import type { SchemaValidatorCache } from './schema-cache.js';

const MAX_SCHEMA_FINDINGS_PER_ATTEMPT = 50;

export interface AttemptEvaluation {
  readonly findings: readonly PartialFinding[];
  readonly passed: boolean;
}

type ParseResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly finding: PartialFinding };

/**
 * Parses one candidate attempt's raw `content` text as bounded JSON, but -- unlike every
 * other decode call site in `@axiom/core` -- never throws for a syntax/bounds problem with
 * the *content itself*. This is the load-bearing distinction the plan draws between "a
 * malformed candidate output" (a `json` category contract finding, exit `1`) and "a
 * malformed artifact envelope/config/schema" (an {@link InputEnvelopeError}/{@link
 * BoundsError} thrown from `../config/*` or the envelope-decoding half of `./sources`,
 * exit `2`): the envelope wrapping this content, and the content's *shape* once parsed, are
 * two different trust boundaries.
 */
function parseCandidateJson(content: string): ParseResult {
  try {
    const value = decodeBoundedJson(content, {
      maxBytes: DEFAULT_LIMITS.maxArtifactBytes,
      maxDepth: DEFAULT_LIMITS.maxJsonDepth,
      maxNodes: DEFAULT_LIMITS.maxJsonNodes,
    });
    return { ok: true, value };
  } catch (error) {
    if (error instanceof InputEnvelopeError || error instanceof BoundsError) {
      return {
        ok: false,
        finding: {
          code: `json.${error.code.replace(/^[a-z]+\./, '')}`,
          category: 'json',
        },
      };
    }
    throw error;
  }
}

function toSchemaFinding(error: ErrorObject, redaction: RedactionSelectors): PartialFinding {
  const segments = safeParsePointerSegments(error.instancePath);
  return {
    code: `schema.${error.keyword}`,
    category: 'schema',
    pointer: redactPointerSegments(segments, redaction),
  };
}

/**
 * Runs the full `json -> schema -> invariant -> policy` pipeline for one attempt's raw
 * content against one compiled contract, short-circuiting at the first failing stage (a
 * document that does not even match its schema is not meaningfully evaluated against
 * invariants/policy that assume that shape). Never throws for a problem intrinsic to
 * `content` itself -- only for a genuine tooling fault (e.g. the contract's schema file
 * cannot be read), which propagates as the usual {@link AxiomError}/exit `3` path.
 */
export async function evaluateAttempt(
  fs: FileSystemPort,
  schemaCache: SchemaValidatorCache,
  contract: CompiledContract,
  redaction: RedactionSelectors,
  content: string,
): Promise<AttemptEvaluation> {
  const parsed = parseCandidateJson(content);
  if (!parsed.ok) {
    return { findings: [parsed.finding], passed: false };
  }

  const validate = await schemaCache.getValidator(fs, contract);
  const document = parsed.value;
  const valid = validate(document);
  if (!valid) {
    const findings = (validate.errors ?? [])
      .slice(0, MAX_SCHEMA_FINDINGS_PER_ATTEMPT)
      .map((error) => toSchemaFinding(error, redaction));
    return { findings, passed: false };
  }

  const invariantFindings: PartialFinding[] = [];
  for (const rule of contract.invariants) {
    if (!evaluateInvariant(rule.assert, document)) {
      invariantFindings.push({ code: 'invariant.failed', category: 'invariant', ruleId: rule.id });
    }
  }
  if (invariantFindings.length > 0) {
    return { findings: invariantFindings, passed: false };
  }

  const policyFindings = evaluateForbidden(contract, document, redaction);
  return { findings: policyFindings, passed: policyFindings.length === 0 };
}
