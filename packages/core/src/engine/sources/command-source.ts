import type { CompiledCommandSource, CompiledRetryConfig } from '../../domain/compiled-config.js';
import { InternalError } from '../../errors.js';
import type { ProcessPort } from '../../runtime/ports.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reduces the ambient environment to exactly the check's configured allowlist -- never the full parent environment. */
export function buildAllowlistedEnv(
  allowlist: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of allowlist) {
    const value = environment[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export interface AttemptContentSource {
  /** Produces the raw candidate content for one (0-based) attempt, on demand. */
  getAttemptContent(attemptIndex: number): Promise<string>;
}

/**
 * Builds an on-demand attempt source that spawns the configured command once per call,
 * applying the configured inter-attempt `delayMs` before every retry (`attemptIndex > 0`).
 *
 * A command-level fault -- timeout, output overflow, a signal, a non-zero exit code, or a
 * spawn failure -- always throws {@link InternalError} (exit `3`) immediately and is never
 * retried: only a live invocation whose stdout was successfully captured and then *failed
 * evaluation as a candidate* is eligible for a retry, per the plan's "retries only for
 * candidate contract failures". `../run-case.ts`'s attempt loop enforces that distinction by
 * construction -- it only calls this again if the previous call resolved.
 */
export function createCommandAttemptSource(
  processPort: ProcessPort,
  source: CompiledCommandSource,
  retries: CompiledRetryConfig,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AttemptContentSource {
  const env = buildAllowlistedEnv(source.env, environment);
  return {
    async getAttemptContent(attemptIndex) {
      if (attemptIndex > 0 && retries.delayMs > 0) {
        await sleep(retries.delayMs);
      }
      const result = await processPort.spawn({
        executable: source.executable,
        args: source.args,
        cwd: source.cwd,
        env,
        timeoutMs: source.timeoutMs,
        maxStdoutBytes: source.maxStdoutBytes,
        maxStderrBytes: source.maxStderrBytes,
      });

      if (result.timedOut) {
        throw new InternalError(
          'internal.command-timeout',
          `Command "${source.executable}" timed out after ${source.timeoutMs}ms.`,
        );
      }
      if (result.stdoutTruncated || result.stderrTruncated) {
        throw new InternalError(
          'internal.command-output-overflow',
          `Command "${source.executable}" exceeded its configured output byte limit.`,
        );
      }
      if (result.signal !== null) {
        throw new InternalError(
          'internal.command-terminated',
          `Command "${source.executable}" was terminated by signal ${result.signal}.`,
        );
      }
      if (result.exitCode !== 0) {
        throw new InternalError(
          'internal.command-exit-nonzero',
          `Command "${source.executable}" exited with status ${String(result.exitCode)}.`,
        );
      }
      return result.stdout;
    },
  };
}
