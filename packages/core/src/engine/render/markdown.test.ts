import { describe, expect, it } from 'vitest';
import type { AxiomReportV1 } from '../../domain/report.js';
import { renderReportMarkdown } from './markdown.js';

function reportWithPointer(pointer: string): AxiomReportV1 {
  return {
    reportVersion: 1,
    metricVersion: 1,
    toolVersion: '0.1.0',
    status: 'fail',
    exitCode: 1,
    configFingerprint: 'cfg',
    populationFingerprint: 'pop',
    checks: [
      {
        checkId: 'check-1',
        contractId: 'contract-1',
        status: 'fail',
        findings: [
          {
            code: 'schema.additional-property',
            category: 'schema',
            checkId: 'check-1',
            caseId: 'case-1',
            attempt: 1,
            pointer,
          },
        ],
      },
    ],
    metrics: [],
  };
}

/**
 * Regression coverage for the "strengthen Markdown safety" cross-review finding: a
 * candidate-influenced string (here, a finding's pointer -- the one finding field with no
 * fixed charset) must never be able to break the surrounding table structure, inject raw
 * HTML, or smuggle control characters into the rendered report.
 */
describe('renderReportMarkdown: candidate-influenced strings cannot break table/document structure', () => {
  it('escapes a pipe so it cannot inject a spurious table column', () => {
    const markdown = renderReportMarkdown(reportWithPointer('/a|evil-column'));
    expect(markdown).toContain('/a\\|evil-column');
    // Splitting on *unescaped* pipes only must still yield the fixed 6-populated-column
    // findings row (Check/Case/Attempt/Category/Code/Pointer; Rule is empty here) -- a naive
    // reader that does not know about the escape would otherwise see a phantom extra column.
    const findingsRow = markdown.split('\n').find((line) => line.includes('/a'));
    expect(findingsRow?.split(/(?<!\\)\|/).filter((s) => s.trim().length > 0)).toHaveLength(6);
  });

  it('escapes a backtick so it cannot break out of an adjacent inline code span', () => {
    const markdown = renderReportMarkdown(reportWithPointer('/a`injected`'));
    expect(markdown).toContain('/a\\`injected\\`');
  });

  it('entity-escapes angle brackets so raw HTML/script tags never survive verbatim', () => {
    const markdown = renderReportMarkdown(reportWithPointer('/a<script>alert(1)</script>'));
    expect(markdown).not.toContain('<script>');
    expect(markdown).toContain('&lt;script&gt;');
  });

  it('collapses embedded newlines so a candidate value cannot add table rows', () => {
    const markdown = renderReportMarkdown(reportWithPointer('/a\nline2\r\nline3'));
    expect(markdown).not.toMatch(/\/a\n/);
    expect(markdown).toContain('/a line2 line3');
  });

  it('strips raw control characters (e.g. ANSI escape prefixes) entirely', () => {
    const markdown = renderReportMarkdown(reportWithPointer('/a\u001b[31mred\u001b[0m'));
    expect(markdown).not.toContain('\u001b');
  });

  it('truncates a pathologically long field instead of rendering it verbatim', () => {
    const markdown = renderReportMarkdown(reportWithPointer(`/${'a'.repeat(5000)}`));
    expect(markdown).toContain('(truncated)');
    expect(markdown.length).toBeLessThan(6000);
  });

  it("escapes a literal backslash so it cannot neutralize the following character's own escape", () => {
    const markdown = renderReportMarkdown(reportWithPointer('/a\\|b'));
    const findingsRow = markdown.split('\n').find((line) => line.includes('/a'));
    // A naive "escape the pipe only" implementation would turn the source `\|` into an
    // *unescaped* table delimiter (the pre-existing backslash accidentally "consuming" the
    // inserted escape backslash), corrupting the column count. Escaping the backslash first
    // must keep the row at the fixed 6-column shape.
    expect(findingsRow?.split(/(?<!\\)\|/).filter((s) => s.trim().length > 0)).toHaveLength(6);
  });
});
