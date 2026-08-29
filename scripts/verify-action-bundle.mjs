#!/usr/bin/env node
// The CI "Action bundle freshness" gate (plan step 6): rebuilds packages/action/src/main.ts
// into a temporary directory with the exact same esbuild invocation used to produce the
// committed dist/action/index.cjs, then byte-diffs the two. Any drift -- a source change
// that was not followed by rebuilding and committing the bundle -- fails (non-zero exit)
// rather than letting a stale bundle ship silently.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildActionBundle } from './build-action-bundle.mjs';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const committedBundlePath = path.join(rootDir, 'dist', 'action', 'index.cjs');

if (!existsSync(committedBundlePath)) {
  console.error(
    `[action:bundle:check] ${path.relative(rootDir, committedBundlePath)} does not exist. ` +
      'Run "node scripts/build-action-bundle.mjs" and commit the result first.',
  );
  process.exit(3);
}

const tempDir = mkdtempSync(path.join(tmpdir(), 'axiom-action-bundle-'));
try {
  const freshBundlePath = path.join(tempDir, 'index.cjs');
  await buildActionBundle(freshBundlePath);

  const committed = readFileSync(committedBundlePath);
  const fresh = readFileSync(freshBundlePath);

  if (!committed.equals(fresh)) {
    console.error(
      `[action:bundle:check] ${path.relative(rootDir, committedBundlePath)} is stale: ` +
        `a fresh rebuild (${fresh.length} bytes) differs from the committed bundle (${committed.length} bytes). ` +
        'Run "node scripts/build-action-bundle.mjs" and commit the result.',
    );
    process.exit(1);
  }

  console.log(
    `[action:bundle:check] ${path.relative(rootDir, committedBundlePath)} is up to date (${committed.length} bytes).`,
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
