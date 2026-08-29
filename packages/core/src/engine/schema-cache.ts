import type { ValidateFunction } from 'ajv/dist/2020.js';
import type { CompiledContract } from '../domain/compiled-config.js';
import { BoundsError, ConfigError } from '../errors.js';
import { decodeBoundedJson } from '../json/decode.js';
import { DEFAULT_LIMITS } from '../limits.js';
import type { FileSystemPort } from '../runtime/ports.js';
import { createAjv } from '../schema/ajv-factory.js';

export interface SchemaValidatorCache {
  getValidator(fs: FileSystemPort, contract: CompiledContract): Promise<ValidateFunction>;
}

/**
 * Lazily compiles and caches one Ajv validator per contract for the lifetime of a single
 * `check`/`compare` invocation. Schema files are only ever read here -- at evaluation time,
 * after config compilation has already succeeded -- never during `loadConfig` itself (see
 * `../config/phase-order.test.ts`).
 */
export function createSchemaValidatorCache(): SchemaValidatorCache {
  const cache = new Map<string, ValidateFunction>();
  return {
    async getValidator(fs, contract) {
      const cached = cache.get(contract.id);
      if (cached) return cached;
      const validator = await compileContractSchema(fs, contract);
      cache.set(contract.id, validator);
      return validator;
    },
  };
}

async function readSchemaJson(fs: FileSystemPort, schemaPath: string): Promise<object> {
  const text = await fs.readFile(schemaPath, { maxBytes: DEFAULT_LIMITS.maxSchemaBytes });
  const parsed = decodeBoundedJson(text, {
    maxBytes: DEFAULT_LIMITS.maxSchemaBytes,
    maxDepth: DEFAULT_LIMITS.maxJsonDepth,
    maxNodes: DEFAULT_LIMITS.maxJsonNodes,
  });
  return parsed as unknown as object;
}

async function compileContractSchema(
  fs: FileSystemPort,
  contract: CompiledContract,
): Promise<ValidateFunction> {
  const ajv = createAjv({ maxPatternLength: DEFAULT_LIMITS.maxPatternLength });

  let resourcesBytes = 0;
  for (const resourcePath of contract.schemaResourcePaths) {
    const resourceSchema = await readSchemaJson(fs, resourcePath);
    resourcesBytes += Buffer.byteLength(JSON.stringify(resourceSchema), 'utf8');
    if (resourcesBytes > DEFAULT_LIMITS.maxSchemaResourcesBytes) {
      throw new BoundsError(
        'bounds.max-bytes-exceeded',
        `Contract "${contract.id}" schema resources exceed ${DEFAULT_LIMITS.maxSchemaResourcesBytes} combined bytes.`,
      );
    }
    try {
      ajv.addSchema(resourceSchema, resourcePath);
    } catch (error) {
      throw new ConfigError(
        'config.invalid-schema',
        `Contract "${contract.id}" schema resource "${resourcePath}" is not a valid JSON Schema.`,
        error,
      );
    }
  }

  const rootSchema = await readSchemaJson(fs, contract.schemaRootPath);
  try {
    return ajv.compile(rootSchema);
  } catch (error) {
    throw new ConfigError(
      'config.invalid-schema',
      `Contract "${contract.id}" root schema is not a valid JSON Schema.`,
      error,
    );
  }
}
