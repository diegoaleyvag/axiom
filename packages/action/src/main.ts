import * as core from '@actions/core';
import { EXIT_CODES } from '@axiom/core';
import { run } from './index.js';

/**
 * The actual process entrypoint bundled to `dist/action/index.cjs` and referenced by the
 * root `action.yml`. Kept separate from `./index.ts` so `run()` stays a pure, importable,
 * unit-testable function that returns the real `0/1/2/3` axiom exit code -- this file's
 * only job is the one thing that differs between "a library function" and "a GitHub Action
 * process": translating that exit code into the Actions runner's binary success/failure
 * convention (`process.exitCode` `0` or `1`, via `core.setFailed`), since the runner itself
 * has no notion of exit codes `2`/`3` distinct from a generic failure.
 *
 * Deliberately an async IIFE rather than top-level `await`: the committed bundle is
 * CommonJS (`dist/action/index.cjs`, chosen so the file's module kind is unambiguous
 * regardless of any nearby `package.json`'s `"type"`), and CommonJS has no top-level await.
 */
void (async () => {
  const exitCode = await run();
  if (exitCode !== EXIT_CODES.SUCCESS) {
    core.setFailed(`axiom: run finished with exit code ${String(exitCode)}.`);
  }
})();
