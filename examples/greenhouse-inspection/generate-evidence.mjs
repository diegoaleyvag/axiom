#!/usr/bin/env node
// Regenerates the committed evidence under ./evidence from the fixtures in this directory,
// by actually running the built `axiom` CLI against axiom.config.yaml -- never hand-edited.
// Requires the workspace to already be built (`pnpm build` from the repository root).
//
// Usage: node examples/greenhouse-inspection/generate-evidence.mjs

import { execFileSync } from 'node:child_process';
import { copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleDir = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.join(exampleDir, '..', '..', 'packages', 'cli', 'dist', 'index.js');

function runAxiom(args) {
  try {
    execFileSync(process.execPath, [cliEntry, ...args], { cwd: exampleDir, stdio: 'pipe' });
  } catch {
    // Every scenario fixture here is *intentionally* a mix of passing and failing cases, so
    // `axiom check`/`axiom compare` exiting non-zero is the expected, documented outcome --
    // not a generation failure. The two commands' actual JSON/Markdown output (copied below)
    // is the evidence, not the process exit code.
  }
}

function copyReport(nameSuffix) {
  copyFileSync(
    path.join(exampleDir, 'evidence', 'current.json'),
    path.join(exampleDir, 'evidence', `${nameSuffix}-report.json`),
  );
  copyFileSync(
    path.join(exampleDir, 'evidence', 'current.md'),
    path.join(exampleDir, 'evidence', `${nameSuffix}-report.md`),
  );
}

runAxiom(['check', '--config', 'axiom.config.yaml']);
copyReport('check');

runAxiom(['compare', '--config', 'axiom.config.yaml']);
copyReport('compare');

rmSync(path.join(exampleDir, 'evidence', 'current.json'));
rmSync(path.join(exampleDir, 'evidence', 'current.md'));

console.log(
  '[generate-evidence] wrote evidence/check-report.{json,md} and evidence/compare-report.{json,md}',
);
