import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Bundled Action <-> CLI parity: both adapters are documented as thin translators over the
 * exact same `@axiom/core` workflow functions (see `../src/index.ts`, `../../cli/src/main.ts`),
 * so for any given fixture they must reach an identical decision. This is the one test in the
 * suite that spawns *both* real built artifacts -- `packages/cli/dist/index.js` and the
 * committed, esbuild-bundled `dist/action/index.cjs` (the exact file `action.yml` runs) -- as
 * separate OS processes against byte-identical fixtures, and diffs their outcomes: the same
 * `0/1/2/3` exit code, and (whenever a report is actually produced) byte-identical JSON/Markdown
 * report output.
 *
 * Requires the workspace to already be built (`pnpm build` or `pnpm typecheck`) *and* the
 * Action bundle to be up to date (`pnpm build:action-bundle`) -- CI's "Action bundle
 * freshness" gate independently guarantees the latter is never stale on `main`.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLI_ENTRY = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js');
const ACTION_BUNDLE = path.join(REPO_ROOT, 'dist', 'action', 'index.cjs');

for (const [label, entry] of [
  ['CLI', CLI_ENTRY],
  ['Action bundle', ACTION_BUNDLE],
] as const) {
  if (!existsSync(entry)) {
    throw new Error(
      `[action-cli-parity.test.ts] ${label} entrypoint "${entry}" does not exist. Run ` +
        '"pnpm build" and "pnpm build:action-bundle" from the repository root first.',
    );
  }
}

const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: { message: { type: 'string' } },
};

const CONFIG = `version: 1
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

async function writeFixture(dir: string, caseContent: unknown, configText = CONFIG): Promise<void> {
  await mkdir(path.join(dir, 'contracts'), { recursive: true });
  await mkdir(path.join(dir, 'cases'), { recursive: true });
  await writeFile(path.join(dir, 'contracts/example.schema.json'), JSON.stringify(SCHEMA), 'utf8');
  await writeFile(path.join(dir, 'cases/example.json'), JSON.stringify(caseContent), 'utf8');
  await writeFile(path.join(dir, 'axiom.config.yaml'), configText, 'utf8');
}

function runCli(args: readonly string[], cwd: string) {
  return spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

interface ActionRunOptions {
  readonly mode?: 'check' | 'compare';
  readonly allowCommand?: boolean;
}

async function runAction(cwd: string, options: ActionRunOptions = {}) {
  const outputPath = path.join(cwd, 'gh-output.txt');
  await writeFile(outputPath, '', 'utf8');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    'INPUT_WORKING-DIRECTORY': cwd,
    INPUT_MODE: options.mode ?? 'check',
    'INPUT_ALLOW-COMMAND': String(options.allowCommand ?? false),
    GITHUB_OUTPUT: outputPath,
  };
  delete env['GITHUB_STEP_SUMMARY'];
  const result = spawnSync(process.execPath, [ACTION_BUNDLE], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env,
  });
  const outputText = existsSync(outputPath) ? await readFile(outputPath, 'utf8') : '';
  const exitCodeMatch = /exit-code<<[^\n]*\n(\d)/.exec(outputText);
  return {
    processExitCode: result.status,
    axiomExitCode: exitCodeMatch ? Number(exitCodeMatch[1]) : undefined,
    stderr: result.stderr,
  };
}

let cliDir: string;
let actionDir: string;

beforeEach(async () => {
  cliDir = await mkdtemp(path.join(tmpdir(), 'axiom-parity-cli-'));
  actionDir = await mkdtemp(path.join(tmpdir(), 'axiom-parity-action-'));
});

afterEach(async () => {
  await rm(cliDir, { recursive: true, force: true });
  await rm(actionDir, { recursive: true, force: true });
});

describe('Action <-> CLI parity: identical axiom decision code for every scenario', () => {
  it('exit 0 (pass): both report a clean pass with byte-identical JSON/Markdown reports', async () => {
    await writeFixture(cliDir, { message: 'hello' });
    await writeFixture(actionDir, { message: 'hello' });

    const cli = runCli(['check', '--config', 'axiom.config.yaml'], cliDir);
    const action = await runAction(actionDir);

    expect(cli.status).toBe(0);
    expect(action.axiomExitCode).toBe(0);

    const cliReport = await readFile(path.join(cliDir, '.axiom/reports/current.json'), 'utf8');
    const actionReport = await readFile(
      path.join(actionDir, '.axiom/reports/current.json'),
      'utf8',
    );
    expect(actionReport).toBe(cliReport);

    const cliMarkdown = await readFile(path.join(cliDir, '.axiom/reports/current.md'), 'utf8');
    const actionMarkdown = await readFile(
      path.join(actionDir, '.axiom/reports/current.md'),
      'utf8',
    );
    expect(actionMarkdown).toBe(cliMarkdown);
  });

  it('exit 1 (contract finding): both report the same schema-category failure with identical reports', async () => {
    await writeFixture(cliDir, { message: 123 });
    await writeFixture(actionDir, { message: 123 });

    const cli = runCli(['check', '--config', 'axiom.config.yaml'], cliDir);
    const action = await runAction(actionDir);

    expect(cli.status).toBe(1);
    expect(action.axiomExitCode).toBe(1);

    const cliReport = JSON.parse(
      await readFile(path.join(cliDir, '.axiom/reports/current.json'), 'utf8'),
    );
    const actionReport = JSON.parse(
      await readFile(path.join(actionDir, '.axiom/reports/current.json'), 'utf8'),
    );
    expect(actionReport).toEqual(cliReport);
  });

  it('exit 2 (invalid config): both reject a config with no matching version the same way', async () => {
    const badConfig =
      'version: 2\ncontracts: []\nchecks: []\nreports:\n  json: r.json\n  markdown: r.md\n';
    await writeFixture(cliDir, { message: 'x' }, badConfig);
    await writeFixture(actionDir, { message: 'x' }, badConfig);

    const cli = runCli(['check', '--config', 'axiom.config.yaml'], cliDir);
    const action = await runAction(actionDir);

    expect(cli.status).toBe(2);
    expect(action.axiomExitCode).toBe(2);
  });

  it('exit 3 (tooling failure): both surface a failing real command-source subprocess identically', async () => {
    const commandConfig = `version: 1
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
      args: ["-e", "process.exit(9)"]
      timeoutMs: 5000
      maxStdoutBytes: 1024
      maxStderrBytes: 1024
reports:
  json: .axiom/reports/current.json
  markdown: .axiom/reports/current.md
`;
    await writeFixture(cliDir, { message: 'unused' }, commandConfig);
    await writeFixture(actionDir, { message: 'unused' }, commandConfig);

    const cli = runCli(['check', '--config', 'axiom.config.yaml', '--allow-command'], cliDir);
    const action = await runAction(actionDir, { allowCommand: true });

    expect(cli.status).toBe(3);
    expect(action.axiomExitCode).toBe(3);
  });
});
