import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SpawnRequest } from './ports.js';
import { createNodeProcess } from './node-process.js';

/**
 * Exercises {@link createNodeProcess} against *real* OS processes (never a scripted fake)
 * to prove every safety property `./node-process.ts` documents actually holds at runtime:
 * no shell metacharacter interpretation, a hard timeout that actually terminates the
 * process, independent stdout/stderr overflow termination, whole-process-tree
 * termination (not just the direct child), immediately-closed stdin, and a verbatim
 * (never merged with the ambient environment) child environment.
 */
describe('createNodeProcess: real OS process safety', () => {
  const processPort = createNodeProcess();
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'axiom-node-process-test-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function writeFixture(name: string, contents: string): Promise<string> {
    const target = path.join(workDir, name);
    await writeFile(target, contents, 'utf8');
    return target;
  }

  function baseRequest(overrides: Partial<SpawnRequest>): SpawnRequest {
    return {
      executable: process.execPath,
      args: [],
      cwd: workDir,
      env: {},
      timeoutMs: 5000,
      maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 1024 * 1024,
      ...overrides,
    };
  }

  describe('command injection: shell metacharacters in argv are never interpreted', () => {
    it('passes an argument containing shell metacharacters through completely literally', async () => {
      const scriptPath = await writeFixture('echo-argv.js', 'console.log(process.argv[2]);\n');
      const markerFile = path.join(workDir, 'should-never-be-created.txt');
      const injected = `; touch ${markerFile}; echo pwned $(whoami) \` id \` && rm -rf / #`;

      const result = await processPort.spawn(baseRequest({ args: [scriptPath, injected] }));

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(injected);
      expect(existsSync(markerFile)).toBe(false);
    });

    it('treats a `; rm` payload as an inert literal string rather than a chained command', async () => {
      const scriptPath = await writeFixture(
        'echo-argv-length.js',
        'console.log(process.argv.length);\n',
      );
      // If a shell were interpreted, ";" would end the command and start a new one,
      // changing how many "arguments" the process actually receives.
      const result = await processPort.spawn(baseRequest({ args: [scriptPath, 'a; b; c'] }));
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('3'); // [execPath, scriptPath, "a; b; c"]
    });
  });

  describe('hard timeout', () => {
    it('kills a process that never exits on its own once the timeout elapses', async () => {
      const scriptPath = await writeFixture('hang.js', 'setInterval(() => {}, 1000);\n');
      const start = Date.now();

      const result = await processPort.spawn(baseRequest({ args: [scriptPath], timeoutMs: 300 }));
      const elapsed = Date.now() - start;

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      // Actually terminated near the configured timeout, not left to run to completion.
      expect(elapsed).toBeLessThan(5000);
    });
  });

  describe('stdout/stderr output overflow', () => {
    it('kills the process and reports stdoutTruncated once stdout exceeds the configured cap', async () => {
      const scriptPath = await writeFixture(
        'spew-stdout.js',
        "setInterval(() => process.stdout.write('x'.repeat(65536)), 5);\n",
      );

      const result = await processPort.spawn(
        baseRequest({ args: [scriptPath], maxStdoutBytes: 100_000, timeoutMs: 5000 }),
      );

      expect(result.stdoutTruncated).toBe(true);
      expect(result.stderrTruncated).toBe(false);
      expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(100_000);
    });

    it('kills the process and reports stderrTruncated once stderr exceeds the configured cap, independent of stdout', async () => {
      const scriptPath = await writeFixture(
        'spew-stderr.js',
        "setInterval(() => process.stderr.write('y'.repeat(65536)), 5);\n",
      );

      const result = await processPort.spawn(
        baseRequest({ args: [scriptPath], maxStderrBytes: 100_000, timeoutMs: 5000 }),
      );

      expect(result.stderrTruncated).toBe(true);
      expect(result.stdoutTruncated).toBe(false);
      expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThanOrEqual(100_000);
    });
  });

  describe('process-tree termination', () => {
    it('kills a grandchild process spawned by the direct child, not just the direct child itself', async () => {
      const heartbeatPath = path.join(workDir, 'heartbeat.log');
      const grandchildPath = await writeFixture(
        'grandchild.js',
        `const fs = require('node:fs');
const target = process.argv[2];
setInterval(() => fs.appendFileSync(target, Date.now() + '\\n'), 30);
`,
      );
      const parentPath = await writeFixture(
        'spawn-grandchild.js',
        `const { spawn } = require('node:child_process');
const path = require('node:path');
const heartbeatTarget = process.argv[2];
const grandchildScript = process.argv[3];
spawn(process.execPath, [grandchildScript, heartbeatTarget], { stdio: 'ignore' });
setInterval(() => {}, 1000);
`,
      );

      const result = await processPort.spawn(
        baseRequest({
          args: [parentPath, heartbeatPath, grandchildPath],
          timeoutMs: 300,
        }),
      );
      expect(result.timedOut).toBe(true);

      const linesAtKill = existsSync(heartbeatPath)
        ? (await readFile(heartbeatPath, 'utf8')).trim().split('\n').length
        : 0;
      expect(linesAtKill).toBeGreaterThan(0); // the grandchild really was running

      // Give any still-alive grandchild ample time to have appended more heartbeats.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const linesAfterWait = existsSync(heartbeatPath)
        ? (await readFile(heartbeatPath, 'utf8')).trim().split('\n').length
        : 0;
      expect(linesAfterWait).toBe(linesAtKill);
    });
  });

  describe('stdin is closed immediately', () => {
    it('a process reading stdin sees EOF right away instead of blocking for input that will never arrive', async () => {
      const scriptPath = await writeFixture(
        'read-stdin.js',
        `process.stdin.on('end', () => {
  console.log('stdin-ended');
  process.exit(0);
});
process.stdin.resume();
`,
      );
      const start = Date.now();

      const result = await processPort.spawn(baseRequest({ args: [scriptPath], timeoutMs: 3000 }));
      const elapsed = Date.now() - start;

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('stdin-ended');
      // If stdin had been left open (inherited/piped without closing), this would have
      // blocked until the full 3000ms timeout instead of resolving almost immediately.
      expect(elapsed).toBeLessThan(1500);
    });
  });

  describe('environment allowlisting', () => {
    it('the child sees exactly the provided env object, never merged with the ambient parent environment', async () => {
      const scriptPath = await writeFixture(
        'print-env.js',
        'console.log(JSON.stringify(process.env));\n',
      );
      // A canary guaranteed to be present in *this* test process's own environment but
      // deliberately not forwarded in the request below.
      process.env['AXIOM_TEST_AMBIENT_CANARY'] = 'must-not-leak';

      const result = await processPort.spawn(
        baseRequest({ args: [scriptPath], env: { ALLOWED_ONE: 'value-one' } }),
      );

      expect(result.exitCode).toBe(0);
      const childEnv = JSON.parse(result.stdout) as Record<string, string>;
      // The OS/runtime itself may inject a handful of platform variables into every new
      // process regardless of what was passed to `spawn` (e.g. macOS's CoreFoundation
      // forces `__CF_USER_TEXT_ENCODING` into every child) -- that is outside Node's or
      // this port's control. What must hold is that *none of this test process's own*
      // ambient variables leak through, and the one variable we did allowlist survives.
      expect(childEnv['ALLOWED_ONE']).toBe('value-one');
      expect(childEnv['AXIOM_TEST_AMBIENT_CANARY']).toBeUndefined();
      expect(childEnv['PATH']).toBeUndefined();
      expect(childEnv['HOME']).toBeUndefined();

      delete process.env['AXIOM_TEST_AMBIENT_CANARY'];
    });
  });
});
