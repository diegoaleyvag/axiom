import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAjv } from '../schema/ajv-factory.js';

const LIMITS = { maxPatternLength: 512 };

function readJson(relativePath: string): unknown {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
}

describe('Five Decisions project manifest', () => {
  it('matches the vendored portable schema without a hosted demo', () => {
    const ajv = createAjv(LIMITS);
    const validate = ajv.compile(
      readJson('../../../../docs/assets/five-decisions-project.schema.json'),
    );
    const manifest = readJson('../../../../portfolio.project.json') as {
      links: { demo: string | null };
    };

    expect(validate(manifest), ajv.errorsText(validate.errors)).toBe(true);
    expect(manifest.links.demo).toBeNull();
  });
});
