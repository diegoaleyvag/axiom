import type { AxiomReportV1 } from '../domain/report.js';
import { redactId, redactText } from '../redaction/redact.js';
import type { CompiledRedactionPattern } from '../redaction/patterns.js';

/**
 * Final defensive redaction pass over an already-value-free report, applying every
 * configured redaction pattern to every remaining free-form string field (`code`,
 * `ruleId`, `pointer`) one more time before rendering. The report model never carries a
 * candidate *value*, and `pointer`/`ruleId` were already redaction-aware at the point each
 * finding was created (see `../engine/redact-pointer.ts`) -- this is the plan's "defensively
 * sanitize every ... string again" belt-and-suspenders layer, not the primary control.
 * Used by every render path, including `axiom report`'s re-render of an externally supplied
 * report file that this process did not itself produce.
 *
 * `ruleId` is redacted through {@link redactId}, not {@link redactText}: it is the one
 * finding field constrained by the report schema's `$defs.id` pattern
 * (`^[A-Za-z][A-Za-z0-9_-]{0,63}$`), so it must round-trip as a schema-valid identifier
 * even after redaction -- `redactText`'s substring-splice placeholder (`[redacted]`) would
 * inject bracket characters the pattern forbids. `code` and `pointer` carry no such
 * charset constraint (only a `maxLength`), so they keep using `redactText`.
 */
export function redactReportDefensively(
  report: AxiomReportV1,
  patterns: readonly CompiledRedactionPattern[],
): AxiomReportV1 {
  if (patterns.length === 0) return report;
  const redact = (text: string): string => redactText(text, patterns);

  return {
    ...report,
    checks: report.checks.map((check) => ({
      ...check,
      findings: check.findings.map((finding) => ({
        ...finding,
        code: redact(finding.code),
        ...(finding.ruleId !== undefined ? { ruleId: redactId(finding.ruleId, patterns) } : {}),
        ...(finding.pointer !== undefined ? { pointer: redact(finding.pointer) } : {}),
      })),
    })),
  };
}
