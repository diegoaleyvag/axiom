import type { JsonValue } from '../../domain/json.js';
import type { AxiomReportV1 } from '../../domain/report.js';

function stableStringify(value: JsonValue, indent: number, depth: number): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  const childPad = ' '.repeat(indent * (depth + 1));
  const closePad = ' '.repeat(indent * depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${childPad}${stableStringify(item, indent, depth + 1)}`);
    return `[\n${items.join(',\n')}\n${closePad}]`;
  }

  const keys = Object.keys(value).sort();
  if (keys.length === 0) return '{}';
  const items = keys.map(
    (key) =>
      `${childPad}${JSON.stringify(key)}: ${stableStringify(value[key] as JsonValue, indent, depth + 1)}`,
  );
  return `{\n${items.join(',\n')}\n${closePad}}`;
}

/**
 * Renders a report as canonical, deterministic JSON: object keys are always sorted
 * alphabetically at every nesting level, so byte-identical input always produces
 * byte-identical output regardless of property insertion order anywhere upstream. Ends with
 * exactly one trailing newline.
 */
export function renderReportJson(report: AxiomReportV1): string {
  return `${stableStringify(report as unknown as JsonValue, 2, 0)}\n`;
}
