import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompiledAxiomConfig } from '../domain/compiled-config.js';
import { ConfigError } from '../errors.js';
import { createNodeFileSystem } from '../runtime/node-filesystem.js';
import { createScriptedProcess } from './test-support/fake-process.js';
import { runAllChecks } from './run-config.js';
import { runCompareWorkflow } from './workflow.js';

const SCHEMA = JSON.stringify({ type: 'object' });

/**
 * Regression coverage for the "enforce real-path/symlink containment before schema,
 * artifact, and baseline reads" cross-review finding: `compileConfig` only performs
 * *syntactic* path resolution (no I/O), so a symlink planted after compilation -- e.g. a
 * schema/artifact/baseline path that looks contained lexically but resolves outside
 * `configDir` once symlinks are followed -- must still be rejected before the referenced
 * file's contents are ever read, exactly like report *write* targets already are (see
 * `./workflow.ts`'s `writeReportOutputs`).
 */
describe('real-path/symlink containment is enforced before schema, artifact, and baseline reads', () => {
  const fs = createNodeFileSystem();
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'axiom-run-config-test-'));
    outside = await mkdtemp(path.join(tmpdir(), 'axiom-run-config-outside-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  function baseConfig(overrides: Partial<CompiledAxiomConfig> = {}): CompiledAxiomConfig {
    return {
      version: 1,
      configPath: path.join(root, 'axiom.config.yaml'),
      configDir: root,
      contracts: new Map(),
      checks: new Map(),
      reports: {
        jsonPath: path.join(root, 'current.json'),
        markdownPath: path.join(root, 'current.md'),
      },
      redaction: { pathSegments: [], patterns: [] },
      ...overrides,
    };
  }

  it('rejects a symlinked schema root that escapes configDir, before any process is spawned', async () => {
    const secretSchema = path.join(outside, 'secret.schema.json');
    await writeFile(secretSchema, SCHEMA);
    const linkedSchema = path.join(root, 'linked.schema.json');
    await symlink(secretSchema, linkedSchema);

    const compiled = baseConfig({
      contracts: new Map([
        [
          'example',
          {
            id: 'example',
            schemaRootPath: linkedSchema,
            schemaResourcePaths: [],
            invariants: [],
            forbiddenPaths: [],
            forbiddenPatterns: [],
          },
        ],
      ]),
    });

    const { port } = createScriptedProcess([]);
    await expect(runAllChecks(fs, port, compiled, { allowCommand: false })).rejects.toThrow(
      ConfigError,
    );
  });

  it('rejects a symlinked artifact item path that escapes configDir', async () => {
    const secretArtifact = path.join(outside, 'secret.json');
    await writeFile(secretArtifact, '{}');
    const linkedArtifact = path.join(root, 'linked.json');
    await symlink(secretArtifact, linkedArtifact);

    const schemaPath = path.join(root, 'schema.json');
    await writeFile(schemaPath, SCHEMA);

    const compiled = baseConfig({
      contracts: new Map([
        [
          'example',
          {
            id: 'example',
            schemaRootPath: schemaPath,
            schemaResourcePaths: [],
            invariants: [],
            forbiddenPaths: [],
            forbiddenPatterns: [],
          },
        ],
      ]),
      checks: new Map([
        [
          'check-1',
          {
            id: 'check-1',
            contractId: 'example',
            source: {
              kind: 'artifacts',
              items: [{ id: 'case-1', path: linkedArtifact, format: 'raw' }],
            },
            retries: { maxAttempts: 1, delayMs: 0 },
          },
        ],
      ]),
    });

    const { port } = createScriptedProcess([]);
    await expect(runAllChecks(fs, port, compiled, { allowCommand: false })).rejects.toThrow(
      ConfigError,
    );
  });

  it('accepts a legitimately contained schema and artifact and runs the check normally', async () => {
    const schemaPath = path.join(root, 'schema.json');
    await writeFile(schemaPath, SCHEMA);
    const artifactPath = path.join(root, 'case.json');
    await writeFile(artifactPath, '{}');

    const compiled = baseConfig({
      contracts: new Map([
        [
          'example',
          {
            id: 'example',
            schemaRootPath: schemaPath,
            schemaResourcePaths: [],
            invariants: [],
            forbiddenPaths: [],
            forbiddenPatterns: [],
          },
        ],
      ]),
      checks: new Map([
        [
          'check-1',
          {
            id: 'check-1',
            contractId: 'example',
            source: {
              kind: 'artifacts',
              items: [{ id: 'case-1', path: artifactPath, format: 'raw' }],
            },
            retries: { maxAttempts: 1, delayMs: 0 },
          },
        ],
      ]),
    });

    const { port } = createScriptedProcess([]);
    const result = await runAllChecks(fs, port, compiled, { allowCommand: false });
    expect(result.checkReports[0]?.status).toBe('pass');
  });

  it('rejects a symlinked baseline report path that escapes configDir before it is read', async () => {
    const secretBaseline = path.join(outside, 'baseline.json');
    await writeFile(
      secretBaseline,
      JSON.stringify({
        reportVersion: 1,
        metricVersion: 1,
        toolVersion: '0.1.0',
        status: 'pass',
        exitCode: 0,
        configFingerprint: 'x',
        populationFingerprint: 'y',
        checks: [],
        metrics: [],
      }),
    );
    const linkedBaseline = path.join(root, 'linked-baseline.json');
    await symlink(secretBaseline, linkedBaseline);

    const schemaPath = path.join(root, 'schema.json');
    await writeFile(schemaPath, SCHEMA);
    const artifactPath = path.join(root, 'case.json');
    await writeFile(artifactPath, '{}');
    // computeConfigFingerprint (invoked while assembling the *current* report, before the
    // baseline is ever consulted) reads the config file's own bytes -- unrelated to this
    // test's subject, but required for `runCompareWorkflow` to reach the baseline-read step.
    await writeFile(path.join(root, 'axiom.config.yaml'), 'version: 1\n');

    const compiled = baseConfig({
      contracts: new Map([
        [
          'example',
          {
            id: 'example',
            schemaRootPath: schemaPath,
            schemaResourcePaths: [],
            invariants: [],
            forbiddenPaths: [],
            forbiddenPatterns: [],
          },
        ],
      ]),
      checks: new Map([
        [
          'check-1',
          {
            id: 'check-1',
            contractId: 'example',
            source: {
              kind: 'artifacts',
              items: [{ id: 'case-1', path: artifactPath, format: 'raw' }],
            },
            retries: { maxAttempts: 1, delayMs: 0 },
          },
        ],
      ]),
      baseline: {
        reportPath: linkedBaseline,
        reportPathRelative: 'linked-baseline.json',
        population: 'comparable',
        thresholds: [],
      },
    });

    const { port } = createScriptedProcess([]);
    await expect(runCompareWorkflow(fs, port, compiled, { allowCommand: false })).rejects.toThrow(
      ConfigError,
    );
  });
});
