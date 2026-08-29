import { describe, expect, it } from 'vitest';
import { AxiomError } from '../errors.js';
import type { FileSystemPort, FileStats, ReadFileOptions } from '../runtime/ports.js';
import { loadConfig } from './load.js';

interface RecordedCalls {
  readFile: string[];
  stat: string[];
  lstat: string[];
  realPath: string[];
}

function createSpyFileSystem(fileContents: Record<string, string>): {
  fs: FileSystemPort;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = { readFile: [], stat: [], lstat: [], realPath: [] };
  const notFound = (kind: string, target: string) => {
    const error = new Error(`ENOENT (spy): ${kind} ${target}`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    return error;
  };
  const fs: FileSystemPort = {
    async readFile(filePath: string, _options: ReadFileOptions) {
      calls.readFile.push(filePath);
      const content = fileContents[filePath];
      if (content === undefined) {
        throw notFound('readFile', filePath);
      }
      return content;
    },
    async stat(filePath: string): Promise<FileStats> {
      calls.stat.push(filePath);
      throw notFound('stat', filePath);
    },
    async lstat(filePath: string): Promise<FileStats> {
      calls.lstat.push(filePath);
      throw notFound('lstat', filePath);
    },
    async realPath(filePath: string) {
      calls.realPath.push(filePath);
      if (fileContents[filePath] === undefined) {
        throw notFound('realPath', filePath);
      }
      return filePath;
    },
  };
  return { fs, calls };
}

const CONFIG_PATH = '/workspace/project/axiom.config.yaml';

describe('loadConfig phase order', () => {
  it('reads only the config file itself, and never stats/realpaths anything, for a config invalid at the YAML layer', async () => {
    const { fs, calls } = createSpyFileSystem({ [CONFIG_PATH]: 'not: [valid yaml' });

    await expect(loadConfig({ fs, configPath: CONFIG_PATH })).rejects.toThrow(AxiomError);

    expect(calls.readFile).toEqual([CONFIG_PATH]);
    expect(calls.stat).toEqual([]);
    expect(calls.lstat).toEqual([]);
    expect(calls.realPath).toEqual([]);
  });

  it('reads only the config file itself for a config invalid at the schema layer', async () => {
    const { fs, calls } = createSpyFileSystem({
      [CONFIG_PATH]: ['version: 1', 'unknownTopLevelKey: true'].join('\n'),
    });

    await expect(loadConfig({ fs, configPath: CONFIG_PATH })).rejects.toThrow(AxiomError);

    expect(calls.readFile).toEqual([CONFIG_PATH]);
    expect(calls.stat).toEqual([]);
    expect(calls.lstat).toEqual([]);
    expect(calls.realPath).toEqual([]);
  });

  it('reads only the config file itself for a config that references a schema path escaping the root', async () => {
    const yaml = [
      'version: 1',
      'contracts:',
      '  - id: extraction',
      '    schema:',
      '      root: ../../etc/passwd',
      'checks:',
      '  - id: check-1',
      '    contract: extraction',
      '    source:',
      '      kind: artifacts',
      '      items:',
      '        - id: canonical',
      '          path: cases/01-valid.json',
      '          format: raw',
      'reports:',
      '  json: .axiom/reports/current.json',
      '  markdown: .axiom/reports/current.md',
    ].join('\n');
    const { fs, calls } = createSpyFileSystem({ [CONFIG_PATH]: yaml });

    await expect(loadConfig({ fs, configPath: CONFIG_PATH })).rejects.toThrow(AxiomError);

    // The escaping path is caught by syntactic resolution alone: no stat/realpath call is
    // needed (or made) to prove "../../etc/passwd" is outside the config root.
    expect(calls.readFile).toEqual([CONFIG_PATH]);
    expect(calls.stat).toEqual([]);
    expect(calls.lstat).toEqual([]);
    expect(calls.realPath).toEqual([]);
  });

  it('reads only the config file itself for a fully valid config (referenced files are not touched by loadConfig)', async () => {
    const yaml = [
      'version: 1',
      'contracts:',
      '  - id: extraction',
      '    schema:',
      '      root: contracts/extraction.schema.json',
      'checks:',
      '  - id: check-1',
      '    contract: extraction',
      '    source:',
      '      kind: artifacts',
      '      items:',
      '        - id: canonical',
      '          path: cases/01-valid.json',
      '          format: raw',
      'reports:',
      '  json: .axiom/reports/current.json',
      '  markdown: .axiom/reports/current.md',
    ].join('\n');
    const { fs, calls } = createSpyFileSystem({ [CONFIG_PATH]: yaml });

    const compiled = await loadConfig({ fs, configPath: CONFIG_PATH });

    expect(compiled.contracts.has('extraction')).toBe(true);
    expect(calls.readFile).toEqual([CONFIG_PATH]);
    expect(calls.stat).toEqual([]);
    expect(calls.lstat).toEqual([]);
    expect(calls.realPath).toEqual([]);
  });
});
