import type { CompiledContract } from '../domain/compiled-config.js';
import type { JsonValue } from '../domain/json.js';
import type { SelectorSegment } from '../invariant/pointer.js';
import type { PartialFinding } from './finding.js';
import { resolveSelector } from './path-resolve.js';
import { redactPointerSegments, type RedactionSelectors } from './redact-pointer.js';
import { boundCandidateSegment } from './safe-pointer.js';

const MAX_POLICY_FINDINGS_PER_RULE = 20;

/**
 * Evaluates every `forbidden.paths`/`forbidden.patterns` rule of one contract against a
 * parsed (schema-valid) candidate document, producing `policy` category findings. Every
 * matched location's pointer is redacted (see `../engine/redact-pointer.ts`) if it falls
 * under a configured redaction path, per the plan's "apply configured redacted paths and
 * patterns before findings are created" -- the pointer, not just the value, must never
 * surface a redacted location.
 *
 * `forbiddenPaths` fails when its selector matches *any* location at all (the field must be
 * wholly absent). `forbiddenPatterns` selects a set of locations and then tests either the
 * string value found there (`target: "stringValues"`) or, for an object location, every one
 * of its own key names (`target: "keys"`) against the compiled RE2 matcher.
 */
export function evaluateForbidden(
  contract: CompiledContract,
  document: JsonValue,
  redaction: RedactionSelectors,
): readonly PartialFinding[] {
  const findings: PartialFinding[] = [];

  for (const rule of contract.forbiddenPaths) {
    const matches = resolveSelector(document, rule.segments);
    if (matches.length > 0) {
      findings.push({
        code: 'policy.forbidden-path',
        category: 'policy',
        ruleId: rule.id,
        pointer: redactPointerSegments(rule.segments.map(segmentLabel), redaction),
      });
    }
  }

  for (const rule of contract.forbiddenPatterns) {
    const matches = resolveSelector(document, rule.segments);
    let recorded = 0;
    for (const match of matches) {
      if (recorded >= MAX_POLICY_FINDINGS_PER_RULE) break;
      if (rule.target === 'stringValues') {
        if (typeof match === 'string' && rule.matcher.test(match)) {
          findings.push({
            code: 'policy.forbidden-pattern',
            category: 'policy',
            ruleId: rule.id,
            pointer: redactPointerSegments(rule.segments.map(segmentLabel), redaction),
          });
          recorded += 1;
        }
      } else if (typeof match === 'object' && match !== null && !Array.isArray(match)) {
        for (const key of Object.keys(match)) {
          if (recorded >= MAX_POLICY_FINDINGS_PER_RULE) break;
          if (rule.matcher.test(key)) {
            // `key` is a raw candidate-controlled object key name -- unlike every other
            // segment here (which is config-authored), its length is bounded only by the
            // overall document byte budget, not by any pointer/selector segment cap. It
            // must be truncated the same way an Ajv `instancePath` segment already is
            // (see `./safe-pointer.ts`) before it is ever formatted into a report pointer.
            const safeKey = boundCandidateSegment(key);
            findings.push({
              code: 'policy.forbidden-pattern-key',
              category: 'policy',
              ruleId: rule.id,
              pointer: redactPointerSegments(
                [...rule.segments.map(segmentLabel), safeKey],
                redaction,
              ),
            });
            recorded += 1;
          }
        }
      }
    }
  }

  return findings;
}

function segmentLabel(segment: SelectorSegment): string {
  return segment.kind === 'wildcard' ? '*' : segment.key;
}
