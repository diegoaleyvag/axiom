#!/usr/bin/env node
// Deterministically bundles the Action adapter (packages/action/src/main.ts) into a single
// dependency-free CommonJS file, committed at dist/action/index.cjs and referenced by the
// root action.yml. "Deterministic" here means: given the same source tree, esbuild produces
// byte-identical output every time (no timestamps, no machine-specific paths in the output,
// no minification-driven nondeterminism) -- see scripts/verify-action-bundle.mjs, which
// rebuilds into a temp directory and byte-diffs the result against what is committed here.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * @param {string} [outfile] Absolute output path; defaults to the committed location.
 */
export async function buildActionBundle(
  outfile = path.join(rootDir, 'dist', 'action', 'index.cjs'),
) {
  await build({
    entryPoints: [path.join(rootDir, 'packages', 'action', 'src', 'main.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    absWorkingDir: rootDir,
    logLevel: 'silent',
  });
  return outfile;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outfile = await buildActionBundle();
  console.log(`[build:action] wrote ${path.relative(rootDir, outfile)}`);
}
