import { createHash } from 'node:crypto';
import type { CompiledAxiomConfig } from '../domain/compiled-config.js';
import { DEFAULT_LIMITS } from '../limits.js';
import type { FileSystemPort } from '../runtime/ports.js';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * A stable fingerprint of the exact config used for one run, so a baseline comparison can
 * (for informational purposes) tell whether the current and baseline runs used the same
 * `axiom.config.yaml` bytes. Hashes the raw file text rather than any in-memory compiled
 * representation, since {@link CompiledAxiomConfig} holds `Map`s and compiled regex matchers
 * that have no single canonical serialization.
 */
export async function computeConfigFingerprint(
  fs: FileSystemPort,
  compiled: CompiledAxiomConfig,
): Promise<string> {
  const text = await fs.readFile(compiled.configPath, { maxBytes: DEFAULT_LIMITS.maxConfigBytes });
  return sha256Hex(text);
}

/**
 * A stable fingerprint of exactly which cases were evaluated this run: every check's sorted
 * case ids, joined deterministically. `axiom compare`'s `exact` population mode requires this
 * to be byte-identical between the current and baseline report; `comparable` mode instead
 * only compares the set of check ids directly available on both reports (see `./compare.ts`).
 */
export function computePopulationFingerprint(
  caseIdsByCheck: ReadonlyMap<string, readonly string[]>,
): string {
  const parts = [...caseIdsByCheck.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([checkId, caseIds]) => `${checkId}:${[...caseIds].sort().join(',')}`);
  return sha256Hex(parts.join('|'));
}
