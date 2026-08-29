# Axiom

**FIVE DECISIONS / APPLIED AI**

## Can an AI output keep its contract?

Axiom is an offline, provider-neutral contract checker for structured AI outputs. It turns one
declarative `axiom.config.yaml` into schema, invariant, and policy checks, then returns a
deterministic, value-free JSON or Markdown report.

The decision is simple: can this output satisfy the contract, and did it regress against the
baseline? Axiom does not call a model, require a token, send telemetry, or make a network call
in normal operation.

## Start with the decision

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js check --config examples/greenhouse-inspection/axiom.config.yaml
node packages/cli/dist/index.js compare --config examples/greenhouse-inspection/axiom.config.yaml
```

The greenhouse-inspection corpus is intentionally mixed. Both `check` and `compare` should
report a contract failure and exit `1`; that failure is the evidence that the checker found the
documented violations and baseline regression. See the
[failure walkthrough](docs/failure-examples.md) and the committed
[check](examples/greenhouse-inspection/evidence/check-report.md) and
[compare](examples/greenhouse-inspection/evidence/compare-report.md) reports.

For a passing scratch project, build Axiom once, then run the built CLI from that project:

```bash
mkdir axiom-scratch
cd axiom-scratch
node /absolute/path/to/axiom/packages/cli/dist/index.js init
node /absolute/path/to/axiom/packages/cli/dist/index.js check
```

`init` writes a no-clobber starter config, contract schema, and passing example artifact.
`check` writes `.axiom/reports/current.{json,md}`.

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

## CLI surface

`pnpm build` compiles every workspace package with TypeScript project references. The built
binary is [`packages/cli/dist/index.js`](packages/cli/package.json).

`axiom` has four commands:

1. `axiom init [configPath]` writes a schema-valid starter config, contract schema, and passing
   example artifact. It never clobbers an existing target, which is exit `2`.
2. `axiom check [--config path] [--allow-command]` evaluates the current input and writes the
   configured JSON and Markdown reports.
3. `axiom compare [--config path] [--allow-command]` evaluates the current input and compares it
   with the configured baseline using exact metrics and population compatibility.
4. `axiom report --report path [--config path]` revalidates, redacts, and re-renders an existing
   report without rereading candidate artifacts.

Every invocation resolves to one of four codes: `0` pass, `1` contract or quality finding,
`2` invalid configuration, invocation, input envelope, or schema, and `3` I/O, spawn, timeout,
overflow, or unexpected tooling failure. See the
[exit-code taxonomy](docs/taxonomy-and-exit-codes.md).

### Minimal recorded-artifact config

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

See the complete, wholly fictional
[greenhouse-inspection corpus](examples/greenhouse-inspection) for schema, invariant,
forbidden-path and pattern policy, retry, and baseline evidence.

## GitHub Action, locally checked out

The Action is a thin adapter over the same engine. The repository-relative example below is
runnable after checkout and intentionally exercises the failing greenhouse corpus. It uses
`continue-on-error` so a discovered contract failure can be inspected in the next step.

```yaml
name: Check structured output

on: [pull_request]

permissions:
  contents: read

jobs:
  axiom:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Axiom check
        id: axiom
        uses: ./
        continue-on-error: true
        with:
          config-path: examples/greenhouse-inspection/axiom.config.yaml
          mode: check
          allow-command: 'false'
      - name: Inspect the decision
        if: always()
        env:
          STATUS: ${{ steps.axiom.outputs.status }}
          EXIT_CODE: ${{ steps.axiom.outputs.exit-code }}
          REPORT_JSON: ${{ steps.axiom.outputs.report-json-path }}
        run: |
          printf 'status=%s exit-code=%s report=%s\n' "$STATUS" "$EXIT_CODE" "$REPORT_JSON"
          test "$STATUS" = "fail"
          test "$EXIT_CODE" = "1"
```

The Action's `status` output is `pass`, `fail`, or `error`. Its `exit-code` output preserves the
full Axiom decision (`0`, `1`, `2`, or `3`), while the Action process itself only has the
GitHub Actions success/failure convention. `allow-command` must remain explicit consent for a
configured command source. See [`action.yml`](action.yml) for the complete input/output
reference and [the example workflow](.github/workflows/axiom-example.yml) for both expected
failure paths. This repository does not claim a published package, tag, release, or Marketplace
listing.

## Reports, evidence, and methodology

Axiom evaluates two source kinds:

- **Artifacts** are already-recorded files on disk, either a raw candidate or an ordered
  attempt envelope.
- **Commands** provide captured stdout from one explicitly consented local executable. Command
  execution is bounded, but it is not a sandbox.

The evaluation order is JSON decode, schema, invariant, and policy. The resulting report carries
stable codes, safe pointers, exact integer metrics, and no candidate values or captured output.
The [threat model](docs/threat-model.md), [report format](docs/report-format.md), and
[architecture records](docs/adr/) explain those boundaries. The [vendored Five Decisions
contract snapshot](docs/assets/five-decisions-contract.md) records the frozen brand version and
hashes used by this documentation adapter.

## Development and release readiness

Run the full local gate from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm action:bundle:check
pnpm examples:evidence:check
node packages/cli/dist/index.js check --config examples/greenhouse-inspection/axiom.config.yaml
node packages/cli/dist/index.js compare --config examples/greenhouse-inspection/axiom.config.yaml
```

The final two commands are expected to exit `1` because the fixture is designed to expose
contract findings and a baseline regression. The other gates must pass, including byte-identical
Action bundle and example evidence checks. This is a local release-readiness gate only. No
package, Action, tag, release, or Marketplace publication is asserted here.

See [`HANDOFF.md`](HANDOFF.md) for the reviewer sequence, known limits, and deferred work.
