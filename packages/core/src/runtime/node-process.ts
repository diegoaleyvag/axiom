import { spawn } from 'node:child_process';
import type { ProcessPort, SpawnRequest, SpawnResult } from './ports.js';

/**
 * Real Node.js-backed {@link ProcessPort} for the explicitly consented command source.
 *
 * Safety properties enforced here (not merely documented):
 *
 * - `shell: false` -- argv is passed directly to `execve`-family syscalls, so no shell
 *   metacharacter (`;`, `|`, `` ` ``, `$()`, ...) in `executable`/`args` is ever interpreted.
 * - stdin is immediately closed (`stdio: ['ignore', ...]`) -- the child can never block
 *   waiting for input that will never arrive.
 * - `detached: true` puts the child in its own process group so a hard timeout can
 *   terminate the whole tree (`process.kill(-pid, 'SIGKILL')`), not just the direct child --
 *   a child that forks its own subprocesses cannot outlive its timeout.
 * - stdout/stderr are drained concurrently with running byte counters; once either exceeds
 *   its configured cap the whole process tree is killed immediately rather than continuing
 *   to buffer unbounded output.
 * - `env` is used verbatim as the *entire* child environment (already reduced to the
 *   check's configured allowlist by the caller) -- never merged with `process.env`.
 */
export function createNodeProcess(): ProcessPort {
  return {
    spawn(request) {
      return runOnce(request);
    },
  };
}

function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      process.kill(pid, 'SIGKILL');
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // The process may have already exited between the overflow/timeout check and this call.
  }
}

function drain(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
  onOverflow: () => void,
): { chunks: Buffer[]; bytes: () => number; truncated: () => boolean } {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  stream.on('data', (chunk: Buffer) => {
    if (truncated) return;
    bytes += chunk.byteLength;
    if (bytes > maxBytes) {
      truncated = true;
      onOverflow();
      return;
    }
    chunks.push(chunk);
  });
  return { chunks, bytes: () => bytes, truncated: () => truncated };
}

function runOnce(request: SpawnRequest): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      env: { ...request.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
    });

    let settled = false;
    let timedOut = false;

    const finish = (result: Omit<SpawnResult, 'stdout' | 'stderr'>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        stdout: Buffer.concat(stdoutState.chunks).toString('utf8'),
        stderr: Buffer.concat(stderrState.chunks).toString('utf8'),
      });
    };

    const onOverflowOrTimeout = (): void => {
      if (child.pid !== undefined) killTree(child.pid);
    };

    const stdoutState = drain(child.stdout, request.maxStdoutBytes, onOverflowOrTimeout);
    const stderrState = drain(child.stderr, request.maxStderrBytes, onOverflowOrTimeout);

    const timer = setTimeout(() => {
      timedOut = true;
      onOverflowOrTimeout();
    }, request.timeoutMs);

    child.once('error', (error) => {
      finish({
        exitCode: null,
        signal: null,
        timedOut,
        stdoutTruncated: stdoutState.truncated(),
        stderrTruncated: stderrState.truncated(),
      });
      // Surfaced via `stderr` staying empty and `exitCode: null`; the caller (the command
      // source) treats a null exit code combined with no successful spawn as an internal
      // failure. The error itself is not otherwise inspected here to avoid leaking raw
      // Node error text past this port.
      void error;
    });

    child.once('close', (exitCode, signal) => {
      finish({
        exitCode,
        signal,
        timedOut,
        stdoutTruncated: stdoutState.truncated(),
        stderrTruncated: stderrState.truncated(),
      });
    });
  });
}
