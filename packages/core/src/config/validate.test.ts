import { describe, expect, it } from 'vitest';
import { ConfigError } from '../errors.js';
import { validateConfigShape } from './validate.js';

function minimalValidConfig(): unknown {
  return {
    version: 1,
    contracts: [
      {
        id: 'extraction',
        schema: { root: 'contracts/extraction.schema.json' },
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
      },
    ],
    reports: { json: '.axiom/reports/current.json', markdown: '.axiom/reports/current.md' },
  };
}

describe('validateConfigShape', () => {
  it('accepts a minimal valid config', () => {
    expect(() => validateConfigShape(minimalValidConfig())).not.toThrow();
  });

  it('accepts a config with invariants, forbidden rules, retries, baseline, and redaction', () => {
    const config = minimalValidConfig() as Record<string, unknown>;
    (config['contracts'] as Record<string, unknown>[])[0] = {
      ...(config['contracts'] as Record<string, unknown>[])[0],
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
    };
    (config['checks'] as Record<string, unknown>[])[0] = {
      ...(config['checks'] as Record<string, unknown>[])[0],
      retries: { maxAttempts: 3, delayMs: 0 },
    };
    config['baseline'] = {
      report: 'baselines/main.json',
      population: 'exact',
      thresholds: [
        { metric: 'firstPassRate', direction: 'max-decrease', amount: '0.02', minDenominator: 20 },
      ],
    };
    config['redaction'] = {
      paths: ['/secretField'],
      patterns: [{ id: 'canary', pattern: 'canary-[0-9]+' }],
    };
    expect(() => validateConfigShape(config)).not.toThrow();
  });

  it('rejects an unknown top-level key', () => {
    const config = { ...(minimalValidConfig() as Record<string, unknown>), extra: 'nope' };
    expect(() => validateConfigShape(config)).toThrow(ConfigError);
  });

  it('rejects an unsupported version', () => {
    const config = { ...(minimalValidConfig() as Record<string, unknown>), version: 2 };
    expect(() => validateConfigShape(config)).toThrow(ConfigError);
  });

  it('rejects a missing required field', () => {
    const config = minimalValidConfig() as Record<string, unknown>;
    delete config['reports'];
    expect(() => validateConfigShape(config)).toThrow(ConfigError);
  });

  it('rejects a command source missing required bounds', () => {
    const config = minimalValidConfig() as Record<string, unknown>;
    (config['checks'] as Record<string, unknown>[])[0] = {
      id: 'cmd-check',
      contract: 'extraction',
      source: { kind: 'command', executable: 'node' },
    };
    expect(() => validateConfigShape(config)).toThrow(ConfigError);
  });

  it('rejects a command timeout above the compiled-in ceiling', () => {
    const config = minimalValidConfig() as Record<string, unknown>;
    (config['checks'] as Record<string, unknown>[])[0] = {
      id: 'cmd-check',
      contract: 'extraction',
      source: {
        kind: 'command',
        executable: 'node',
        timeoutMs: 999_999_999,
        maxStdoutBytes: 1024,
        maxStderrBytes: 1024,
      },
    };
    expect(() => validateConfigShape(config)).toThrow(ConfigError);
  });

  it('rejects a non-object value entirely', () => {
    expect(() => validateConfigShape('not an object')).toThrow(ConfigError);
    expect(() => validateConfigShape(null)).toThrow(ConfigError);
    expect(() => validateConfigShape([1, 2, 3])).toThrow(ConfigError);
  });
});
