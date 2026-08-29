import { describe, expect, it } from 'vitest';
import { BoundsError, ConfigError } from '../errors.js';
import { decodeBoundedYaml } from './decode.js';

const OPTIONS = { maxBytes: 4096, maxDepth: 32, maxNodes: 1000 };

describe('decodeBoundedYaml', () => {
  it('decodes a simple mapping/sequence document', () => {
    const yaml = ['version: 1', 'items:', '  - a', '  - b', 'nested:', '  key: value'].join('\n');
    expect(decodeBoundedYaml(yaml, OPTIONS)).toEqual({
      version: 1,
      items: ['a', 'b'],
      nested: { key: 'value' },
    });
  });

  it('rejects duplicate mapping keys', () => {
    const yaml = ['a: 1', 'a: 2'].join('\n');
    expect(() => decodeBoundedYaml(yaml, OPTIONS)).toThrow(ConfigError);
  });

  it('rejects anchors and aliases entirely, not just merge keys', () => {
    const yaml = ['base: &b', '  x: 1', 'copy: *b'].join('\n');
    expect(() => decodeBoundedYaml(yaml, OPTIONS)).toThrow(ConfigError);
  });

  it('rejects "<<" merge-key usage', () => {
    const yaml = ['base: &b', '  x: 1', 'derived:', '  <<: *b', '  y: 2'].join('\n');
    expect(() => decodeBoundedYaml(yaml, OPTIONS)).toThrow(ConfigError);
  });

  it('rejects an unresolvable custom tag', () => {
    const yaml = 'value: !mytag hello';
    expect(() => decodeBoundedYaml(yaml, OPTIONS)).toThrow(ConfigError);
  });

  it('rejects malformed YAML syntax', () => {
    const yaml = 'a: [1, 2\nb: unterminated flow sequence';
    expect(() => decodeBoundedYaml(yaml, OPTIONS)).toThrow(ConfigError);
  });

  it('rejects a document over the byte cap', () => {
    const yaml = `value: "${'x'.repeat(5000)}"`;
    expect(() => decodeBoundedYaml(yaml, { ...OPTIONS, maxBytes: 100 })).toThrow(BoundsError);
  });

  it('rejects a "__proto__" mapping key', () => {
    expect(() => decodeBoundedYaml('__proto__:\n  polluted: true', OPTIONS)).toThrow(BoundsError);
  });

  it('does not implicitly resolve bare scalars as timestamps under the core schema', () => {
    const decoded = decodeBoundedYaml('date: 2024-01-01', OPTIONS) as { date: unknown };
    expect(decoded.date).toBe('2024-01-01');
    expect(typeof decoded.date).toBe('string');
  });
});
