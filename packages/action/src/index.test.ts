import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './index.js';

let workDir: string;
let stdout: string[];

const INPUT_KEYS = [
  'INPUT_CONFIG-PATH',
  'INPUT_MODE',
  'INPUT_ALLOW-COMMAND',
  'INPUT_WORKING-DIRECTORY',
];

function clearActionEnv(): void {
  for (const key of INPUT_KEYS) delete process.env[key];
  delete process.env['GITHUB_OUTPUT'];
  delete process.env['GITHUB_STEP_SUMMARY'];
}

function outputText(): string {
  return stdout.join('');
}

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'axiom-action-test-'));
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  clearActionEnv();
  process.env['INPUT_WORKING-DIRECTORY'] = workDir;
});

afterEach(async () => {
  vi.restoreAllMocks();
  clearActionEnv();
  await rm(workDir, { recursive: true, force: true });
});

const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: { message: { type: 'string' }, secret: { type: 'string' } },
};

const BASE_CONFIG = `version: 1
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

async function writeConfig(text: string): Promise<void> {
  await writeFile(path.join(workDir, 'axiom.config.yaml'), text, 'utf8');
}

async function writeSchemaAndCase(caseContent: unknown, schema: unknown = SCHEMA): Promise<void> {
  await mkdir(path.join(workDir, 'contracts'), { recursive: true });
  await mkdir(path.join(workDir, 'cases'), { recursive: true });
  await writeFile(
    path.join(workDir, 'contracts/example.schema.json'),
    JSON.stringify(schema),
    'utf8',
  );
  await writeFile(path.join(workDir, 'cases/example.json'), JSON.stringify(caseContent), 'utf8');
}

/**
 * `@actions/core`'s `summary` object is a *module-level singleton* that memoizes
 * `GITHUB_STEP_SUMMARY`'s resolved path the first time `write()` succeeds (see
 * `filePath()` in `@actions/core/lib/summary.js`) and never re-reads the environment
 * variable again for the lifetime of the process. That is a non-issue for a real Action
 * run (one process per run), but means at most *one* test per file may exercise the job
 * summary; every other test only needs `GITHUB_OUTPUT` (which `setOutput` re-reads from
 * the environment on every call, with no such caching).
 */
async function touchOutputFile(): Promise<string> {
  const outputPath = path.join(workDir, 'gh-output.txt');
  await writeFile(outputPath, '', 'utf8');
  process.env['GITHUB_OUTPUT'] = outputPath;
  return outputPath;
}

describe('Action run(): exit 0', () => {
  it('passes and emits outputs/summary/notice for a valid check', async () => {
    await writeSchemaAndCase({ message: 'hello' });
    await writeConfig(BASE_CONFIG);
    const outputPath = await touchOutputFile();
    const summaryPath = path.join(workDir, 'gh-summary.md');
    await writeFile(summaryPath, '', 'utf8');
    process.env['GITHUB_STEP_SUMMARY'] = summaryPath;

    const exitCode = await run();

    expect(exitCode).toBe(0);
    expect(outputText()).toContain('::notice::axiom: pass (exit 0).');

    const outputs = await readFile(outputPath, 'utf8');
    expect(outputs).toContain('status');
    expect(outputs).toContain('pass');
    expect(outputs).toContain('exit-code');

    const summary = await readFile(summaryPath, 'utf8');
    expect(summary).toContain('# Axiom Report');
    expect(summary).toContain('**pass**');
  });

  it('is a no-op for the job summary when GITHUB_STEP_SUMMARY is unset', async () => {
    await writeSchemaAndCase({ message: 'hello' });
    await writeConfig(BASE_CONFIG);
    process.env['GITHUB_OUTPUT'] = path.join(workDir, 'gh-output.txt');
    await writeFile(process.env['GITHUB_OUTPUT'], '', 'utf8');

    await expect(run()).resolves.toBe(0);
  });
});

describe('Action run(): exit 1 (contract finding)', () => {
  it('emits an error annotation identifying the schema finding', async () => {
    await writeSchemaAndCase({ message: 123 });
    await writeConfig(BASE_CONFIG);
    await touchOutputFile();

    const exitCode = await run();

    expect(exitCode).toBe(1);
    expect(outputText()).toContain(
      '::error::axiom: check=example-check case=example-case attempt=1 category=schema',
    );
  });
});

describe('Action run(): exit 2 (invalid config/invocation)', () => {
  it('maps a missing config to exit 2 with no GITHUB_OUTPUT/SUMMARY files required', async () => {
    const exitCode = await run();
    expect(exitCode).toBe(2);
    expect(outputText()).toContain('config.not-found');
  });

  it('still sets the "exit-code" output on the error path, not only on a successful run', async () => {
    const outputPath = await touchOutputFile();
    const exitCode = await run();
    expect(exitCode).toBe(2);
    const outputs = await readFile(outputPath, 'utf8');
    expect(outputs).toContain('exit-code');
    expect(outputs).toMatch(/exit-code<<[^\n]*\n2/);
  });

  it('rejects an unknown "mode" input', async () => {
    await writeSchemaAndCase({ message: 'x' });
    await writeConfig(BASE_CONFIG);
    process.env['INPUT_MODE'] = 'delete-everything';

    const exitCode = await run();
    expect(exitCode).toBe(2);
  });

  it('rejects a command-source check without allow-command consent', async () => {
    const configText = `version: 1
contracts:
  - id: example
    schema:
      root: contracts/example.schema.json
checks:
  - id: cmd-check
    contract: example
    source:
      kind: command
      executable: node
      args: ["-e", "console.log(1)"]
      timeoutMs: 5000
      maxStdoutBytes: 1024
      maxStderrBytes: 1024
reports:
  json: .axiom/reports/current.json
  markdown: .axiom/reports/current.md
`;
    await writeSchemaAndCase({ message: 'unused' });
    await writeConfig(configText);

    const exitCode = await run();
    expect(exitCode).toBe(2);
  });
});

describe('Action run(): exit 3 (internal/tooling failure)', () => {
  it('sets the "exit-code" output to "3" on the error path', async () => {
    const configText = `version: 1
contracts:
  - id: example
    schema:
      root: contracts/example.schema.json
checks:
  - id: cmd-check
    contract: example
    source:
      kind: command
      executable: node
      args: ["-e", "process.exit(9)"]
      timeoutMs: 5000
      maxStdoutBytes: 1024
      maxStderrBytes: 1024
reports:
  json: .axiom/reports/current.json
  markdown: .axiom/reports/current.md
`;
    await writeSchemaAndCase({ message: 'unused' });
    await writeConfig(configText);
    process.env['INPUT_ALLOW-COMMAND'] = 'true';
    const outputPath = await touchOutputFile();

    const exitCode = await run();

    expect(exitCode).toBe(3);
    const outputs = await readFile(outputPath, 'utf8');
    expect(outputs).toMatch(/exit-code<<[^\n]*\n3/);
  });

  it('maps a failing command source to exit 3 even with allow-command: true', async () => {
    const configText = `version: 1
contracts:
  - id: example
    schema:
      root: contracts/example.schema.json
checks:
  - id: cmd-check
    contract: example
    source:
      kind: command
      executable: node
      args: ["-e", "process.exit(9)"]
      timeoutMs: 5000
      maxStdoutBytes: 1024
      maxStderrBytes: 1024
reports:
  json: .axiom/reports/current.json
  markdown: .axiom/reports/current.md
`;
    await writeSchemaAndCase({ message: 'unused' });
    await writeConfig(configText);
    process.env['INPUT_ALLOW-COMMAND'] = 'true';

    const exitCode = await run();
    expect(exitCode).toBe(3);
  });
});

describe('Action run(): compare mode', () => {
  it('detects a baseline regression as exit 1', async () => {
    await writeSchemaAndCase({ message: 123 }); // fails, so finalPassRate = 0/1
    const baselineReport = {
      reportVersion: 1,
      metricVersion: 1,
      toolVersion: '0.1.0',
      status: 'pass',
      exitCode: 0,
      configFingerprint: 'baseline-cfg',
      populationFingerprint: 'baseline-pop',
      checks: [{ checkId: 'example-check', contractId: 'example', status: 'pass', findings: [] }],
      metrics: [{ id: 'finalPassRate', numerator: 100, denominator: 100, value: '1.000000' }],
    };
    await writeFile(path.join(workDir, 'baseline.json'), JSON.stringify(baselineReport), 'utf8');

    const configText = `${BASE_CONFIG}baseline:
  report: baseline.json
  population: comparable
  thresholds:
    - metric: finalPassRate
      direction: max-decrease
      amount: "0.1"
      minDenominator: 1
`;
    await writeConfig(configText);
    process.env['INPUT_MODE'] = 'compare';
    await touchOutputFile();

    const exitCode = await run();

    expect(exitCode).toBe(1);
    expect(outputText()).toContain(
      'axiom: baseline threshold "finalPassRate" (max-decrease) -- fail.',
    );
  });
});

describe('Action run(): secret safety', () => {
  it('never leaks a forbidden-field secret value into annotations, outputs, or the job summary', async () => {
    const secretMarker = 'AXIOM_SYNTHETIC_SECRET_zzq7f1';
    const configText = `version: 1
contracts:
  - id: example
    schema:
      root: contracts/example.schema.json
    forbidden:
      paths:
        - id: no-secret-field
          selector: /secret
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
    await writeSchemaAndCase({ message: 'hello', secret: secretMarker });
    await writeConfig(configText);
    const outputPath = await touchOutputFile();

    const exitCode = await run();

    expect(exitCode).toBe(1);
    expect(outputText()).toContain('category=policy');
    expect(outputText()).not.toContain(secretMarker);

    const outputs = await readFile(outputPath, 'utf8');
    const report = await readFile(path.join(workDir, '.axiom/reports/current.json'), 'utf8');
    expect(outputs).not.toContain(secretMarker);
    expect(report).not.toContain(secretMarker);
  });
});
