import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../limits.js';

const CONFIG_SCHEMA_PATH = fileURLToPath(
  new URL('../../../../schemas/axiom-config.v1.schema.json', import.meta.url),
);

interface JsonSchemaDefs {
  readonly $defs: Record<
    string,
    { readonly properties?: Record<string, { readonly maximum?: number }> }
  >;
}

describe('axiom-config.v1.schema.json numeric ceilings', () => {
  const schema = JSON.parse(readFileSync(CONFIG_SCHEMA_PATH, 'utf8')) as JsonSchemaDefs;

  it('mirrors DEFAULT_LIMITS.maxCommandTimeoutMs for commandSource.timeoutMs', () => {
    expect(schema.$defs['commandSource']?.properties?.['timeoutMs']?.maximum).toBe(
      DEFAULT_LIMITS.maxCommandTimeoutMs,
    );
  });

  it('mirrors DEFAULT_LIMITS.maxStdoutBytes for commandSource.maxStdoutBytes', () => {
    expect(schema.$defs['commandSource']?.properties?.['maxStdoutBytes']?.maximum).toBe(
      DEFAULT_LIMITS.maxStdoutBytes,
    );
  });

  it('mirrors DEFAULT_LIMITS.maxStderrBytes for commandSource.maxStderrBytes', () => {
    expect(schema.$defs['commandSource']?.properties?.['maxStderrBytes']?.maximum).toBe(
      DEFAULT_LIMITS.maxStderrBytes,
    );
  });

  it('mirrors DEFAULT_LIMITS.maxAttempts for retries.maxAttempts', () => {
    expect(schema.$defs['retries']?.properties?.['maxAttempts']?.maximum).toBe(
      DEFAULT_LIMITS.maxAttempts,
    );
  });
});
