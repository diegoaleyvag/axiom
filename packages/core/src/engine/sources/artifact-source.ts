import type { CompiledArtifactSource } from '../../domain/compiled-config.js';
import { InputEnvelopeError } from '../../errors.js';
import { decodeBoundedJson } from '../../json/decode.js';
import { DEFAULT_LIMITS } from '../../limits.js';
import type { FileSystemPort } from '../../runtime/ports.js';
import type { EngineCase } from '../case.js';
import { validateArtifactEnvelope } from '../validate-artifact.js';

/**
 * Loads every configured artifact item as one {@link EngineCase}. A `raw` item is the
 * literal bytes of its file treated as a single one-attempt case (per
 * `../../domain/artifact.ts`'s documented contract -- there is no envelope to validate at
 * all). An `envelope` item is decoded and schema-validated against
 * `schemas/axiom-artifact.v1.schema.json`; a malformed envelope is an
 * {@link InputEnvelopeError} (exit `2`), never a `json` category contract finding -- that
 * classification is reserved for a *candidate attempt's* content, evaluated later by
 * `../evaluate-attempt.ts`.
 */
export async function loadArtifactCases(
  fs: FileSystemPort,
  source: CompiledArtifactSource,
): Promise<readonly EngineCase[]> {
  const cases: EngineCase[] = [];
  for (const item of source.items) {
    const text = await fs.readFile(item.path, { maxBytes: DEFAULT_LIMITS.maxArtifactBytes });

    if (item.format === 'raw') {
      cases.push({ caseId: item.id, attempts: [text] });
      continue;
    }

    const decoded = decodeBoundedJson(text, {
      maxBytes: DEFAULT_LIMITS.maxArtifactBytes,
      maxDepth: DEFAULT_LIMITS.maxJsonDepth,
      maxNodes: DEFAULT_LIMITS.maxJsonNodes,
    });
    const envelope = validateArtifactEnvelope(decoded);
    if (envelope.caseId !== item.id) {
      throw new InputEnvelopeError(
        'input.case-id-mismatch',
        `Artifact envelope at "${item.path}" has caseId "${envelope.caseId}", expected "${item.id}".`,
      );
    }
    cases.push({
      caseId: envelope.caseId,
      attempts: envelope.attempts.map((attempt) => attempt.content),
    });
  }
  return cases;
}
