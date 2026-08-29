import path from 'node:path';
import { createNodeFileSystem, EXIT_CODES, type ExitCode } from '@axiom/core';
import type { ParsedArgs } from '../argv.js';

const DEFAULT_CONFIG_FILENAME = 'axiom.config.yaml';

const STARTER_SCHEMA_JSON = `${JSON.stringify(
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['message'],
    properties: {
      message: { type: 'string', minLength: 1, maxLength: 4096 },
    },
  },
  null,
  2,
)}\n`;

const STARTER_ARTIFACT_JSON = `${JSON.stringify({ message: 'hello from axiom init' })}\n`;

function starterConfigYaml(): string {
  return `version: 1
contracts:
  - id: example
    schema:
      root: contracts/example.schema.json
checks:
  - id: example-check
    contract: example
    source:
      kind: artifacts
      items:
        - id: example-case
          path: cases/example.json
          format: raw
reports:
  json: .axiom/reports/current.json
  markdown: .axiom/reports/current.md
`;
}

/**
 * `axiom init [configPath]`: writes a minimal, schema-valid starter config plus a matching
 * contract schema and one passing example artifact, all no-clobber (an existing target at
 * any of the three paths produces exit `2` via {@link FileSystemPort.writeFile}'s default
 * `noClobber` behavior -- see `../../packages/core/src/runtime/node-filesystem.ts`) rather
 * than silently overwriting a real config.
 */
export async function runInit(parsed: ParsedArgs): Promise<ExitCode> {
  const configPath = path.resolve(parsed.positionals[0] ?? DEFAULT_CONFIG_FILENAME);
  const configDir = path.dirname(configPath);
  const schemaPath = path.join(configDir, 'contracts', 'example.schema.json');
  const artifactPath = path.join(configDir, 'cases', 'example.json');

  const fs = createNodeFileSystem();
  await fs.writeFile(configPath, starterConfigYaml());
  await fs.writeFile(schemaPath, STARTER_SCHEMA_JSON);
  await fs.writeFile(artifactPath, STARTER_ARTIFACT_JSON);

  process.stdout.write(
    `axiom: created ${path.relative(process.cwd(), configPath)}, ` +
      `${path.relative(process.cwd(), schemaPath)}, and ` +
      `${path.relative(process.cwd(), artifactPath)}.\n`,
  );
  return EXIT_CODES.SUCCESS;
}
