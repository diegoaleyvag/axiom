import { describe, expect, it } from 'vitest';
import type { CompiledCommandSource, CompiledRetryConfig } from '../../domain/compiled-config.js';
import { InternalError } from '../../errors.js';
import { createScriptedProcess, ok } from '../test-support/fake-process.js';
import { buildAllowlistedEnv, createCommandAttemptSource } from './command-source.js';

const SOURCE: CompiledCommandSource = {
  kind: 'command',
  executable: 'fake-tool',
  args: ['--extract'],
  cwd: '/work',
  timeoutMs: 5000,
  maxStdoutBytes: 1024,
  maxStderrBytes: 1024,
  env: ['ALLOWED_ONE'],
};

const NO_RETRY: CompiledRetryConfig = { maxAttempts: 1, delayMs: 0 };

describe('buildAllowlistedEnv', () => {
  it('includes only allowlisted keys present in the environment, never the full environment', () => {
    const env = buildAllowlistedEnv(['A', 'B'], { A: '1', C: '3' });
    expect(env).toEqual({ A: '1' });
  });
});

describe('createCommandAttemptSource', () => {
  it('spawns with the reduced environment and returns stdout on a clean exit', async () => {
    const { port, requests } = createScriptedProcess([ok('{"result":true}')]);
    const source = createCommandAttemptSource(port, SOURCE, NO_RETRY, {
      ALLOWED_ONE: 'x',
      SECRET: 'y',
    });

    const content = await source.getAttemptContent(0);

    expect(content).toBe('{"result":true}');
    expect(requests[0]?.env).toEqual({ ALLOWED_ONE: 'x' });
    expect(requests[0]?.executable).toBe('fake-tool');
  });

  it('throws InternalError (exit 3) on timeout -- never evaluated as a candidate', async () => {
    const { port } = createScriptedProcess([
      {
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: true,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    ]);
    const source = createCommandAttemptSource(port, SOURCE, NO_RETRY, {});
    await expect(source.getAttemptContent(0)).rejects.toThrow(InternalError);
  });

  it('throws InternalError on output overflow', async () => {
    const { port } = createScriptedProcess([
      {
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        stdoutTruncated: true,
        stderrTruncated: false,
      },
    ]);
    const source = createCommandAttemptSource(port, SOURCE, NO_RETRY, {});
    await expect(source.getAttemptContent(0)).rejects.toThrow(InternalError);
  });

  it('throws InternalError on a non-zero exit code', async () => {
    const { port } = createScriptedProcess([
      {
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    ]);
    const source = createCommandAttemptSource(port, SOURCE, NO_RETRY, {});
    await expect(source.getAttemptContent(0)).rejects.toThrow(InternalError);
  });

  it('applies the configured inter-attempt delay before a retry, not before the first attempt', async () => {
    const { port } = createScriptedProcess([ok('a'), ok('b')]);
    const retries: CompiledRetryConfig = { maxAttempts: 2, delayMs: 20 };
    const source = createCommandAttemptSource(port, SOURCE, retries, {});

    const start = performance.now();
    await source.getAttemptContent(0);
    const firstElapsed = performance.now() - start;
    await source.getAttemptContent(1);
    const secondElapsed = performance.now() - start;

    expect(firstElapsed).toBeLessThan(20);
    expect(secondElapsed - firstElapsed).toBeGreaterThanOrEqual(15);
  });
});
