import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AxiomConfigFileV1 } from '../domain/config.js';
import { ConfigError } from '../errors.js';
import { compileConfig } from './compile.js';

const CONFIG_PATH = '/workspace/project/axiom.config.yaml';
const CONFIG_DIR = path.dirname(CONFIG_PATH);

function baseConfig(): AxiomConfigFileV1 {
  return {
    version: 1,
    contracts: [
      {
        id: 'extraction',
        schema: {
          root: 'contracts/extraction.schema.json',
          resources: ['contracts/shared.schema.json'],
        },
        invariants: [
          {
            id: 'count-matches',
            assert: {
              kind: 'eq',
              left: { kind: 'path', pointer: '/summary/count' },
              right: { kind: 'count', of: { kind: 'select', selector: '/items/*' } },
            },
          },
        ],
        forbidden: {
          paths: [{ id: 'no-debug', selector: '/debug' }],
          patterns: [
            { id: 'no-secret', selector: '/**', target: 'stringValues', pattern: 'BEGIN PRIVATE' },
          ],
        },
      },
    ],
    checks: [
      {
        id: 'extraction-fixture',
        contract: 'extraction',
        source: {
          kind: 'artifacts',
          items: [{ id: 'canonical', path: 'cases/01-valid.json', format: 'raw' }],
        },
        retries: { maxAttempts: 1 },
      },
    ],
    baseline: {
      report: 'baselines/main.json',
      population: 'exact',
      thresholds: [
        { metric: 'firstPassRate', direction: 'max-decrease', amount: '0.02', minDenominator: 20 },
      ],
    },
    reports: { json: '.axiom/reports/current.json', markdown: '.axiom/reports/current.md' },
    redaction: { paths: ['/secretField'], patterns: [{ id: 'canary', pattern: 'canary-[0-9]+' }] },
  };
}

describe('compileConfig', () => {
  it('compiles a full config, resolving every path under the config directory', () => {
    const compiled = compileConfig(baseConfig(), CONFIG_PATH);

    expect(compiled.configDir).toBe(CONFIG_DIR);
    const contract = compiled.contracts.get('extraction');
    expect(contract?.schemaRootPath).toBe(
      path.join(CONFIG_DIR, 'contracts/extraction.schema.json'),
    );
    expect(contract?.schemaResourcePaths).toEqual([
      path.join(CONFIG_DIR, 'contracts/shared.schema.json'),
    ]);
    expect(contract?.invariants[0]?.assert.kind).toBe('eq');
    expect(contract?.forbiddenPaths[0]?.segments).toEqual([{ kind: 'exact', key: 'debug' }]);

    const check = compiled.checks.get('extraction-fixture');
    expect(check?.contractId).toBe('extraction');
    expect(check?.retries).toEqual({ maxAttempts: 1, delayMs: 0 });

    expect(compiled.baseline?.reportPath).toBe(path.join(CONFIG_DIR, 'baselines/main.json'));
    expect(compiled.reports.jsonPath).toBe(path.join(CONFIG_DIR, '.axiom/reports/current.json'));
    expect(compiled.redaction.patterns).toHaveLength(1);
  });

  it('resolves a command source cwd relative to the config dir, defaulting to it when absent', () => {
    const config = baseConfig();
    config.checks = [
      {
        id: 'cmd-check',
        contract: 'extraction',
        source: {
          kind: 'command',
          executable: 'node',
          args: ['run.mjs'],
          timeoutMs: 5000,
          maxStdoutBytes: 1024,
          maxStderrBytes: 1024,
        },
      },
    ];
    const compiled = compileConfig(config, CONFIG_PATH);
    const source = compiled.checks.get('cmd-check')?.source;
    expect(source?.kind).toBe('command');
    if (source?.kind === 'command') {
      expect(source.cwd).toBe(CONFIG_DIR);
    }
  });

  it('rejects duplicate contract ids', () => {
    const config = baseConfig();
    config.contracts = [...config.contracts, { ...config.contracts[0]! }];
    expect(() => compileConfig(config, CONFIG_PATH)).toThrow(ConfigError);
  });

  it('rejects duplicate check ids', () => {
    const config = baseConfig();
    config.checks = [...config.checks, { ...config.checks[0]! }];
    expect(() => compileConfig(config, CONFIG_PATH)).toThrow(ConfigError);
  });

  it('rejects a check that references an unknown contract', () => {
    const config = baseConfig();
    config.checks = [{ ...config.checks[0]!, contract: 'does-not-exist' }];
    expect(() => compileConfig(config, CONFIG_PATH)).toThrow(ConfigError);
  });

  it('rejects a schema path that escapes the config root', () => {
    const config = baseConfig();
    config.contracts = [{ ...config.contracts[0]!, schema: { root: '../../etc/passwd' } }];
    expect(() => compileConfig(config, CONFIG_PATH)).toThrow(ConfigError);
  });

  it('rejects an unknown baseline threshold metric', () => {
    const config = baseConfig();
    config.baseline = {
      report: 'baselines/main.json',
      population: 'exact',
      thresholds: [{ metric: 'notAMetric' as never, direction: 'max-decrease' }],
    };
    expect(() => compileConfig(config, CONFIG_PATH)).toThrow(ConfigError);
  });

  it('rejects duplicate artifact item ids within one check', () => {
    const config = baseConfig();
    config.checks = [
      {
        id: 'extraction-fixture',
        contract: 'extraction',
        source: {
          kind: 'artifacts',
          items: [
            { id: 'dup', path: 'a.json', format: 'raw' },
            { id: 'dup', path: 'b.json', format: 'raw' },
          ],
        },
      },
    ];
    expect(() => compileConfig(config, CONFIG_PATH)).toThrow(ConfigError);
  });

  it('rejects a redaction pattern that is not valid RE2 syntax', () => {
    const config = baseConfig();
    config.redaction = { patterns: [{ id: 'bad', pattern: '(unclosed' }] };
    expect(() => compileConfig(config, CONFIG_PATH)).toThrow(ConfigError);
  });
});
