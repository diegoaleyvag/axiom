import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './main.js';

let workDir: string;
let stdout: string[];
let stderr: string[];

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'axiom-cli-test-'));
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(workDir, { recursive: true, force: true });
});

const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: { message: { type: 'string' } },
};

async function writeConfig(configText: string): Promise<string> {
  const configPath = path.join(workDir, 'axiom.config.yaml');
  await writeFile(configPath, configText, 'utf8');
  return configPath;
}

async function writeSchemaAndCase(caseContent: unknown): Promise<void> {
  await mkdir(path.join(workDir, 'contracts'), { recursive: true });
  await mkdir(path.join(workDir, 'cases'), { recursive: true });
  await writeFile(
    path.join(workDir, 'contracts/example.schema.json'),
    JSON.stringify(SCHEMA),
    'utf8',
  );
  await writeFile(path.join(workDir, 'cases/example.json'), JSON.stringify(caseContent), 'utf8');
}

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

describe('axiom CLI: exit 0', () => {
  it('--help and --version succeed without touching the filesystem', async () => {
    expect(await main(['--help'])).toBe(0);
    expect(await main(['--version'])).toBe(0);
  });

  it('init creates a starter config, schema, and artifact; check on that starter passes', async () => {
    const configPath = path.join(workDir, 'axiom.config.yaml');
    expect(await main(['init', configPath])).toBe(0);
    expect(await main(['check', '--config', configPath])).toBe(0);

    const report = JSON.parse(
      await readFile(path.join(workDir, '.axiom/reports/current.json'), 'utf8'),
    );
    expect(report.status).toBe('pass');
  });
});

describe('axiom CLI: exit 1 (contract finding)', () => {
  it('check fails with exit 1 when the candidate violates its schema', async () => {
    await writeSchemaAndCase({ message: 123 });
    const configPath = await writeConfig(BASE_CONFIG);

    const code = await main(['check', '--config', configPath]);

    expect(code).toBe(1);
    const report = JSON.parse(
      await readFile(path.join(workDir, '.axiom/reports/current.json'), 'utf8'),
    );
    expect(report.status).toBe('fail');
    expect(report.checks[0].findings[0].category).toBe('schema');
  });
});

describe('axiom CLI: exit 2 (invalid config/invocation)', () => {
  it('a missing --config target is an invocation error, not a crash', async () => {
    const code = await main(['check', '--config', path.join(workDir, 'does-not-exist.yaml')]);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('config.not-found');
  });

  it('a malformed YAML config is exit 2', async () => {
    const configPath = await writeConfig('not: [valid yaml');
    expect(await main(['check', '--config', configPath])).toBe(2);
  });

  it('a command-source check without --allow-command is exit 2', async () => {
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
    const configPath = await writeConfig(configText);
    expect(await main(['check', '--config', configPath])).toBe(2);
  });

  it('axiom report with no --report option is exit 2', async () => {
    await writeSchemaAndCase({ message: 'x' });
    const configPath = await writeConfig(BASE_CONFIG);
    expect(await main(['report', '--config', configPath])).toBe(2);
  });
});

describe('axiom CLI: exit 3 (internal/tooling failure)', () => {
  it('a failing command source (non-zero exit) is exit 3, even though the check has retries', async () => {
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
      args: ["-e", "process.exit(7)"]
      timeoutMs: 5000
      maxStdoutBytes: 1024
      maxStderrBytes: 1024
    retries:
      maxAttempts: 3
reports:
  json: .axiom/reports/current.json
  markdown: .axiom/reports/current.md
`;
    await writeSchemaAndCase({ message: 'unused' });
    const configPath = await writeConfig(configText);
    expect(await main(['check', '--config', configPath, '--allow-command'])).toBe(3);
  });
});

describe('axiom CLI: compare', () => {
  it('compares a passing current run against a matching baseline report and passes its threshold', async () => {
    await writeSchemaAndCase({ message: 'hello' });
    const baselineReport = {
      reportVersion: 1,
      metricVersion: 1,
      toolVersion: '0.1.0',
      status: 'pass',
      exitCode: 0,
      configFingerprint: 'baseline-cfg',
      populationFingerprint: 'baseline-pop',
      checks: [{ checkId: 'example-check', contractId: 'example', status: 'pass', findings: [] }],
      metrics: [{ id: 'finalPassRate', numerator: 90, denominator: 100, value: '0.900000' }],
    };
    await writeFile(path.join(workDir, 'baseline.json'), JSON.stringify(baselineReport), 'utf8');

    const configText = `${BASE_CONFIG}baseline:
  report: baseline.json
  population: comparable
  thresholds:
    - metric: finalPassRate
      direction: max-decrease
      amount: "0.5"
      minDenominator: 1
`;
    const configPath = await writeConfig(configText);

    const code = await main(['compare', '--config', configPath]);
    expect(code).toBe(0);

    const report = JSON.parse(
      await readFile(path.join(workDir, '.axiom/reports/current.json'), 'utf8'),
    );
    expect(report.comparison.thresholds[0].result).toBe('pass');
  });
});

describe('axiom CLI: report', () => {
  it("mirrors an existing report's exit code without re-evaluating anything", async () => {
    await writeSchemaAndCase({ message: 'unused' });
    const configPath = await writeConfig(BASE_CONFIG);

    const existingReport = {
      reportVersion: 1,
      metricVersion: 1,
      toolVersion: '0.1.0',
      status: 'fail',
      exitCode: 1,
      configFingerprint: 'x',
      populationFingerprint: 'y',
      checks: [{ checkId: 'example-check', contractId: 'example', status: 'fail', findings: [] }],
      metrics: [],
    };
    const inputPath = path.join(workDir, 'external-report.json');
    await writeFile(inputPath, JSON.stringify(existingReport), 'utf8');

    const code = await main(['report', '--config', configPath, '--report', inputPath]);
    expect(code).toBe(1);

    const markdown = await readFile(path.join(workDir, '.axiom/reports/current.md'), 'utf8');
    expect(markdown).toContain('fail');
  });
});
