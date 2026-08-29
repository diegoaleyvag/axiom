# Axiom

Axiom validates structured AI outputs as software contracts, offline and provider-neutral.

It compiles one declarative `axiom.config.yaml` into schema, invariant, and policy checks
against recorded artifacts or a locally-run command, runs a single deterministic evaluation
engine shared by a local CLI and a bundled GitHub Action, and produces a value-free,
schema-versioned JSON/Markdown report with exact fractional metrics and stable finding codes.
There is no provider SDK, no network access, and no telemetry: everything Axiom does is a pure
function of the config and the input you point it at.

- **Deterministic.** The same config and input always produce byte-identical reports. Metrics
  are exact integer numerator/denominator pairs, compared by cross-multiplication or fixed
  decimal parsing -- never a binary float.
- **Safe by construction.** Invariant/policy rules are a closed declarative AST (no `eval`, no
  JSONPath filters, no template strings). Every path is real-path/symlink-contained to the
  config root. Command execution is `spawn`-based (`shell: false`), with closed stdin, a
  minimal allowlisted environment, hard timeouts, output caps, and whole-process-tree
  termination.
- **Value-free reports.** A report carries stable finding codes, categories, redaction-aware
  pointers, and rule/check/case identifiers -- never a candidate value, raw schema-error data,
  or captured stdout/stderr.
- **One engine, two adapters.** [`packages/core`](packages/core) owns every decision; the CLI
  ([`packages/cli`](packages/cli)) and GitHub Action ([`packages/action`](packages/action),
  bundled to [`dist/action/index.cjs`](dist/action/index.cjs)) only translate argv/inputs in and
  a report/exit code out.

See [`docs/threat-model.md`](docs/threat-model.md), [`docs/configuration.md`](docs/configuration.md),
[`docs/taxonomy-and-exit-codes.md`](docs/taxonomy-and-exit-codes.md), and
[`docs/report-format.md`](docs/report-format.md) for the full reference. See
[`HANDOFF.md`](HANDOFF.md) for how to review this repository end to end.

## Requirements

- Node.js `>=24 <25`
- [pnpm](https://pnpm.io/) `11.18.0` (pinned in [`package.json`](package.json)'s
  `packageManager` field)

## Install and build

```bash
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` compiles every workspace package (`tsc --build`, using TypeScript project
references) to each package's `dist/`. The `axiom` CLI binary lives at
[`packages/cli/dist/index.js`](packages/cli/package.json) once built.

## CLI quickstart

```bash
# From an empty scratch directory:
node /path/to/axiom-foundation/packages/cli/dist/index.js init
# -> writes axiom.config.yaml, contracts/example.schema.json, cases/example.json

node /path/to/axiom-foundation/packages/cli/dist/index.js check
# -> axiom: pass (exit 0)
# -> writes .axiom/reports/current.{json,md}
```

Or, from within this workspace, run any command straight off the built dist:

```bash
node packages/cli/dist/index.js --help
```

`axiom` has four commands:

| Command                                           | What it does                                                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `axiom init [configPath]`                         | Writes a minimal, schema-valid starter config, contract schema, and one passing example artifact. No-clobber: an existing target is exit `2`.                       |
| `axiom check [--config path] [--allow-command]`   | Compiles the config, evaluates the current input, writes the configured JSON/Markdown reports, and returns the decision code.                                       |
| `axiom compare [--config path] [--allow-command]` | Evaluates current input and compares it against the configured baseline report using the same engine, enforcing population compatibility and regression thresholds. |
| `axiom report --report path [--config path]`      | Validates, defensively redacts, and re-renders an existing canonical report, mirroring its decision without rereading candidate artifacts.                          |

Exit codes are always exactly one of `0` (pass), `1` (a contract/quality/regression finding),
`2` (invalid configuration/invocation/input envelope/schema), or `3` (I/O, spawn, timeout,
overflow, or another unexpected tooling failure) -- see
[`docs/taxonomy-and-exit-codes.md`](docs/taxonomy-and-exit-codes.md).

A minimal `axiom.config.yaml`:

```yaml
version: 1
contracts:
  - id: example
    schema:
      root: contracts/example.schema.json
checks:
  - id: example-check
    contract: example
    source:
      kind: artifacts
      items:
        - id: example-case
          path: cases/example.json
          format: raw
reports:
  json: .axiom/reports/current.json
  markdown: .axiom/reports/current.md
```

See [`examples/greenhouse-inspection`](examples/greenhouse-inspection) for a complete,
original, wholly fictional acceptance corpus exercising schema, invariant, forbidden-path/
pattern policy, retries, and baseline comparison end to end, with committed evidence.

## GitHub Action quickstart

The Action is a thin adapter over the exact same engine: no token, no provider SDK, no network
access.

```yaml
- uses: ./ # or a pinned ref once this repository is published
  with:
    config-path: axiom.config.yaml
    mode: check # or "compare"
    allow-command: 'false' # explicit consent required for a command-source check
outputs:
  status: pass | fail | error
  exit-code: '0' | '1' | '2' | '3' # the full decision; the process itself only exits 0/1
  report-json-path: absolute path to the written JSON report
  report-markdown-path: absolute path to the written Markdown report
```

See [`action.yml`](action.yml) for the complete input/output reference and
[`.github/workflows/axiom-example.yml`](.github/workflows/axiom-example.yml) for a
runnable, secret-free example against the committed greenhouse-inspection fixtures.

## Development

```bash
pnpm format:check          # prettier --check .
pnpm typecheck             # tsc --build (also emits dist/, identical to "build")
pnpm test                  # vitest run: unit, property-based, CLI/Action subprocess E2E
pnpm build                 # tsc --build
pnpm build:action-bundle   # rebuild dist/action/index.cjs (esbuild, deterministic)
pnpm action:bundle:check   # fail if the committed Action bundle is stale
pnpm examples:evidence:check  # fail if committed example evidence is stale
```

See [`docs/`](docs) for design docs and [`docs/adr/`](docs/adr) for architecture decision
records. [`HANDOFF.md`](HANDOFF.md) lists the exact commands a reviewer should run, along with
known limits and deferred work (most notably: no SARIF output yet).
