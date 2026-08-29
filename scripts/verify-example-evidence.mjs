#!/usr/bin/env node
// The CI "compare evidence regeneration" gate: copies examples/greenhouse-inspection into two
// fresh temporary directories, regenerates "check" and "compare" evidence in each by actually
// running the built `axiom` CLI (the same procedure as
// examples/greenhouse-inspection/generate-evidence.mjs, applied out of place so the committed
// originals are never touched), then byte-diffs every regenerated evidence file against what
// is committed. Any drift -- a fixture/engine change that was not followed by regenerating and
// committing the evidence -- fails (non-zero exit) rather than letting stale, hand-editable
// evidence ship silently. Requires the workspace to already be built (`pnpm build`), exactly
// like `examples/greenhouse-inspection/generate-evidence.mjs` itself.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exampleDir = path.join(rootDir, 'examples', 'greenhouse-inspection');
const cliEntry = path.join(rootDir, 'packages', 'cli', 'dist', 'index.js');

if (!existsSync(cliEntry)) {
  console.error(
    `[examples:evidence:check] ${path.relative(rootDir, cliEntry)} does not exist. ` +
      'Run "pnpm build" first.',
  );
  process.exit(3);
}

function runAxiomIn(workingCopy, args) {
  try {
    execFileSync(process.execPath, [cliEntry, ...args], { cwd: workingCopy, stdio: 'pipe' });
  } catch {
    // Every scenario fixture is *intentionally* a mix of passing and failing cases, so a
    // non-zero axiom exit here is expected -- see generate-evidence.mjs for the same
    // rationale. Only the regenerated report *files* (diffed below) are the evidence.
  }
}

function freshEvidenceCopy(subdirName, args) {
  const workingCopy = path.join(tempDir, subdirName);
  cpSync(exampleDir, workingCopy, { recursive: true });
  runAxiomIn(workingCopy, args);
  return {
    json: readFileSync(path.join(workingCopy, 'evidence', 'current.json')),
    markdown: readFileSync(path.join(workingCopy, 'evidence', 'current.md')),
  };
}

const tempDir = mkdtempSync(path.join(tmpdir(), 'axiom-example-evidence-'));
try {
  const checkRun = freshEvidenceCopy('check-only', ['check', '--config', 'axiom.config.yaml']);
  const compareRun = freshEvidenceCopy('compare-only', [
    'compare',
    '--config',
    'axiom.config.yaml',
  ]);
  const fresh = {
    'check-report.json': checkRun.json,
    'check-report.md': checkRun.markdown,
    'compare-report.json': compareRun.json,
    'compare-report.md': compareRun.markdown,
  };

  let mismatches = 0;
  for (const [name, freshBuffer] of Object.entries(fresh)) {
    const committedPath = path.join(exampleDir, 'evidence', name);
    const committed = readFileSync(committedPath);
    if (!committed.equals(freshBuffer)) {
      mismatches += 1;
      console.error(
        `[examples:evidence:check] ${path.relative(rootDir, committedPath)} is stale: ` +
          `a fresh regeneration (${freshBuffer.length} bytes) differs from the committed evidence (${committed.length} bytes).`,
      );
    }
  }

  if (mismatches > 0) {
    console.error(
      `[examples:evidence:check] ${mismatches} evidence file(s) are stale. Run ` +
        '"node examples/greenhouse-inspection/generate-evidence.mjs" (after "pnpm build") and commit the result.',
    );
    process.exit(1);
  }

  console.log(
    `[examples:evidence:check] all ${Object.keys(fresh).length} committed evidence files match a fresh regeneration.`,
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
