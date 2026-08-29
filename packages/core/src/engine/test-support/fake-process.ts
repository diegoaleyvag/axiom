import type { ProcessPort, SpawnRequest, SpawnResult } from '../../runtime/ports.js';

/** A scripted {@link ProcessPort}: each call to `spawn` returns the next entry in `results`, in order. */
export function createScriptedProcess(
  results: readonly (SpawnResult | ((request: SpawnRequest) => SpawnResult))[],
): { readonly port: ProcessPort; readonly requests: SpawnRequest[] } {
  const requests: SpawnRequest[] = [];
  let index = 0;
  return {
    requests,
    port: {
      async spawn(request) {
        requests.push(request);
        const entry = results[Math.min(index, results.length - 1)];
        index += 1;
        if (entry === undefined) {
          throw new Error('createScriptedProcess: no scripted result available');
        }
        return typeof entry === 'function' ? entry(request) : entry;
      },
    },
  };
}

export function ok(stdout: string): SpawnResult {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}
