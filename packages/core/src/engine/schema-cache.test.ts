import { describe, expect, it } from 'vitest';
import type { CompiledContract } from '../domain/compiled-config.js';
import { ConfigError } from '../errors.js';
import { createSchemaValidatorCache } from './schema-cache.js';
import { createInMemoryFileSystem } from './test-support/fake-fs.js';

function contract(overrides: Partial<CompiledContract> = {}): CompiledContract {
  return {
    id: 'example',
    schemaRootPath: '/root.schema.json',
    schemaResourcePaths: [],
    invariants: [],
    forbiddenPaths: [],
    forbiddenPatterns: [],
    ...overrides,
  };
}

describe('createSchemaValidatorCache', () => {
  it('compiles the root schema and caches it across repeated calls for the same contract', async () => {
    const fs = createInMemoryFileSystem({
      '/root.schema.json': JSON.stringify({ type: 'string' }),
    });
    const cache = createSchemaValidatorCache();
    const first = await cache.getValidator(fs, contract());
    const second = await cache.getValidator(fs, contract());
    expect(first).toBe(second);
    expect(first('a string')).toBe(true);
    expect(first(42)).toBe(false);
  });

  it('registers schema resources so the root schema can $ref them locally', async () => {
    const fs = createInMemoryFileSystem({
      '/root.schema.json': JSON.stringify({ $ref: '/shared.schema.json' }),
      '/shared.schema.json': JSON.stringify({ type: 'number' }),
    });
    const cache = createSchemaValidatorCache();
    const validate = await cache.getValidator(
      fs,
      contract({ schemaResourcePaths: ['/shared.schema.json'] }),
    );
    expect(validate(5)).toBe(true);
    expect(validate('nope')).toBe(false);
  });

  it('wraps an invalid schema document as ConfigError (exit 2), not a crash', async () => {
    const fs = createInMemoryFileSystem({
      '/root.schema.json': JSON.stringify({ type: 'not-a-real-type' }),
    });
    const cache = createSchemaValidatorCache();
    await expect(cache.getValidator(fs, contract())).rejects.toThrow(ConfigError);
  });
});
