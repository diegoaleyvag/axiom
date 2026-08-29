import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * True subprocess end-to-end coverage: unlike `./main.test.ts` (which calls the `main()`
 * function in-process, through Vitest's `@axiom/cli` source alias), every test here spawns
 * the actual *built* `packages/cli/dist/index.js` entrypoint as a real OS child process --
 * exercising the real shebang/`process.exitCode` boundary, real stdout/stderr streams, and
 * the exact artifact a published package/`npm link` would run, with no source alias or
 * in-process shortcut of any kind.
 *
 * Requires the workspace to already be built (`pnpm build` or `pnpm typecheck`, which is an
 * identical `tsc --build` invocation -- see root `package.json`); CI always runs `typecheck`
 * before `test`, so `packages/cli/dist/index.js` is guaranteed to exist by the time this
 * file runs there.
 */
const CLI_ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

if (!existsSync(CLI_ENTRY)) {
  throw new Error(
    `[cli.subprocess.test.ts] ${CLI_ENTRY} does not exist. Run "pnpm build" (or "pnpm typecheck") ` +
      'from the repository root before running this test file.',
  );
}

function runCli(args: readonly string[], cwd: string) {
  return spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'axiom-cli-subprocess-test-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: { message: { type: 'string' } },
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

describe('axiom CLI (real subprocess): exit 0', () => {
  it('--help prints usage and exits 0 without touching the filesystem', () => {
    const result = runCli(['--help'], workDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('axiom --');
    expect(result.signal).toBeNull();
  });

  it('--version prints a version string and exits 0', () => {
    const result = runCli(['--version'], workDir);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('init then check: a freshly initialized starter config passes its own example', async () => {
    const configPath = path.join(workDir, 'axiom.config.yaml');
    const initResult = runCli(['init', configPath], workDir);
    expect(initResult.status).toBe(0);

    const checkResult = runCli(['check', '--config', configPath], workDir);
    expect(checkResult.status).toBe(0);
    expect(checkResult.stdout).toContain('pass');

    const report = JSON.parse(
      await readFile(path.join(workDir, '.axiom/reports/current.json'), 'utf8'),
    );
    expect(report.status).toBe('pass');
  });
});

describe('axiom CLI (real subprocess): exit 1 (contract finding)', () => {
  it('check reports exit 1 for a schema-violating candidate', async () => {
    await writeSchemaAndCase({ message: 123 });
    await writeFile(path.join(workDir, 'axiom.config.yaml'), BASE_CONFIG, 'utf8');

    const result = runCli(['check', '--config', 'axiom.config.yaml'], workDir);
    expect(result.status).toBe(1);

    const report = JSON.parse(
      await readFile(path.join(workDir, '.axiom/reports/current.json'), 'utf8'),
    );
    expect(report.status).toBe('fail');
    expect(report.checks[0].findings[0].category).toBe('schema');
  });
});

describe('axiom CLI (real subprocess): exit 2 (invalid config/invocation)', () => {
  it('a missing --config target exits 2 with a stable error code on stderr', () => {
    const result = runCli(['check', '--config', 'does-not-exist.yaml'], workDir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('config.not-found');
  });

  it('an unknown command exits 2', () => {
    const result = runCli(['definitely-not-a-command'], workDir);
    expect(result.status).toBe(2);
  });

  it('a command-source check without --allow-command exits 2', async () => {
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
    await writeFile(path.join(workDir, 'axiom.config.yaml'), configText, 'utf8');

    const result = runCli(['check', '--config', 'axiom.config.yaml'], workDir);
    expect(result.status).toBe(2);
  });
});

describe('axiom CLI (real subprocess): exit 3 (internal/tooling failure)', () => {
  it('a failing real command-source subprocess (non-zero exit) surfaces as exit 3', async () => {
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
      executable: ${JSON.stringify(process.execPath)}
      args: ["-e", "process.exit(7)"]
      timeoutMs: 5000
      maxStdoutBytes: 1024
      maxStderrBytes: 1024
reports:
  json: .axiom/reports/current.json
  markdown: .axiom/reports/current.md
`;
    await writeSchemaAndCase({ message: 'unused' });
    await writeFile(path.join(workDir, 'axiom.config.yaml'), configText, 'utf8');

    const result = runCli(['check', '--config', 'axiom.config.yaml', '--allow-command'], workDir);
    expect(result.status).toBe(3);
  });
});

describe('axiom CLI (real subprocess): compare', () => {
  it('compares a passing current run against a matching baseline and passes its threshold', async () => {
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
    await writeFile(path.join(workDir, 'axiom.config.yaml'), configText, 'utf8');

    const result = runCli(['compare', '--config', 'axiom.config.yaml'], workDir);
    expect(result.status).toBe(0);
  });
});

describe('axiom CLI (real subprocess): report', () => {
  it("mirrors an existing report's exit code without re-evaluating anything", async () => {
    await writeSchemaAndCase({ message: 'unused' });
    await writeFile(path.join(workDir, 'axiom.config.yaml'), BASE_CONFIG, 'utf8');

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
    await writeFile(
      path.join(workDir, 'external-report.json'),
      JSON.stringify(existingReport),
      'utf8',
    );

    const result = runCli(
      ['report', '--config', 'axiom.config.yaml', '--report', 'external-report.json'],
      workDir,
    );
    expect(result.status).toBe(1);

    const markdown = await readFile(path.join(workDir, '.axiom/reports/current.md'), 'utf8');
    expect(markdown).toContain('fail');
  });
});
