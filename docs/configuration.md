# Configuration reference (`axiom.config.yaml`)

This document describes every field of the versioned config format, in the exact order
`packages/core` processes it: **decode -> validate -> compile**. Nothing referenced by the
config (a schema, an artifact, a baseline report, a command) is ever touched until all three
phases succeed for the config file itself -- see [`docs/threat-model.md`](threat-model.md)
and `packages/core/src/config/phase-order.test.ts`.

The structural shape is defined in
[`schemas/axiom-config.v1.schema.json`](../schemas/axiom-config.v1.schema.json) and decoded by
[`packages/core/src/config/decode.ts`](../packages/core/src/config/decode.ts) /
[`validate.ts`](../packages/core/src/config/validate.ts); semantic compilation (path
resolution, cross-reference checks, the invariant/policy expression grammar) is
[`packages/core/src/config/compile.ts`](../packages/core/src/config/compile.ts).

## Top-level shape

```yaml
version: 1 # required, must be exactly 1

contracts: [...] # required, 1-256 entries
checks: [...] # required, 1-1024 entries
baseline: { ... } # optional -- required only for "axiom compare"
reports: { ... } # required
redaction: { ... } # optional
```

Every object in this format rejects unknown keys (`additionalProperties: false` throughout
the schema) and every mapping is decoded with YAML 1.2's `uniqueKeys: true`, so a duplicated
key or typo'd field name is a config error, never silently ignored or last-write-wins.

## Paths

Every path field in this document (`schema.root`, `schema.resources[]`, artifact
`items[].path`, `source.cwd`, `baseline.report`, `reports.json`, `reports.markdown`) is
**relative to the directory containing `axiom.config.yaml`**, and must:

- use `/` separators (never `\`)
- contain no `.`/`..` segments, no empty segments (`//` or a trailing `/`), no NUL byte, and
  no `:` within a segment
- not be absolute (`/...`), home-relative (`~/...`), or a drive-letter/UNC path
- resolve to a location strictly inside the config directory

This is enforced syntactically at compile time
([`resolveConfigRelativePath`](../packages/core/src/config/paths.ts)) with no filesystem
access, and again at the moment the file is actually opened
([`assertRealPathContained`](../packages/core/src/config/paths.ts)), which resolves symlinks
through the injected filesystem port and re-verifies containment against the _real_ path --
so a symlink cannot be used to point a syntactically-valid config path outside the config
root. See [ADR 0004](adr/0004-exact-baseline-comparison.md) and the threat model for why this
matters for `baseline.report` specifically.

## `contracts[]`

One contract binds a JSON Schema to a set of invariant and forbidden-path/pattern policy
rules. A contract does not say _how_ candidate data reaches it -- that is `checks[].source`.

```yaml
contracts:
  - id: my-contract # ^[A-Za-z][A-Za-z0-9_-]{0,63}$, unique
    schema:
      root: contracts/my-contract.schema.json
      resources: [] # optional additional schemas addressable by $ref
    invariants: [] # optional, see "Invariant and policy expressions" below
    forbidden:
      paths: [] # optional
      patterns: [] # optional
```

- `schema.root` is compiled with [Ajv 2020-12](../packages/core/src/schema/ajv-factory.ts) in
  strict, non-mutating mode (`removeAdditional`/`useDefaults`/`coerceTypes` all `false`):
  Axiom only ever _reports_ on a candidate document, it never rewrites it. There is no
  `$data` and no remote `$ref` resolution (`loadSchema` is not configured), so schema
  compilation is always fully offline.
- Every `pattern`/`patternProperties` keyword in the schema (and every `forbidden.patterns[]`
  / `redaction.patterns[]` pattern) is compiled through a bounded RE2 adapter
  ([`compileBoundedPattern`](../packages/core/src/schema/regex-engine.ts)), never native
  backtracking `RegExp`, so no pattern -- however configured -- can cause catastrophic
  backtracking against attacker-influenced candidate data.

### `forbidden.paths[]`

Fails the moment its `selector` matches **any** location at all -- the field must be wholly
absent from the candidate document.

```yaml
forbidden:
  paths:
    - id: no-internal-notes # unique per contract
      selector: /inspector/internalNotes
```

### `forbidden.patterns[]`

Selects a set of locations, then tests either the string value found there
(`target: stringValues`) or, for an object location, every one of its own key names
(`target: keys`) against a bounded RE2 pattern.

```yaml
forbidden:
  patterns:
    - id: no-secret-marker
      selector: /observations/*/note
      target: stringValues # or "keys"
      pattern: 'AXIOM_SYNTHETIC_SECRET_[A-Za-z0-9]+'
      flags: [i] # optional subset of "i" (case-insensitive), "m" (multiline), "s" (dotall)
```

`selector` is an exact RFC 6901 JSON Pointer plus bounded `*` wildcard segments (one level per
`*`; no recursive/multi-level wildcard). See
[`packages/core/src/invariant/pointer.ts`](../packages/core/src/invariant/pointer.ts).

### Invariant and policy expressions

`invariants[].assert` is a node in a **closed declarative expression AST** -- there is no
JavaScript, JSONPath filter, template string, or `eval` escape hatch anywhere in the grammar
(see [ADR 0003](adr/0003-safe-declarative-rules.md)). The full grammar is enumerated in
[`packages/core/src/invariant/ast.ts`](../packages/core/src/invariant/ast.ts) and enforced by
[`compileExpr`](../packages/core/src/invariant/compile.ts):

| `kind`                                    | Shape                                     | Meaning                                                                                        |
| ----------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `literal`                                 | `{ kind: "literal", value }`              | A literal JSON value.                                                                          |
| `path`                                    | `{ kind: "path", pointer }`               | Resolves one exact RFC 6901 pointer; missing -> a sentinel, never a throw.                     |
| `select`                                  | `{ kind: "select", selector }`            | Resolves a bounded selector (exact segments + `*`) to a list of matches.                       |
| `count`                                   | `{ kind: "count", of }`                   | The number of matches `of` (a `select`) produced.                                              |
| `eq` / `ne` / `lt` / `lte` / `gt` / `gte` | `{ kind, left, right }`                   | Value comparison. Non-comparable types fail closed to `false`.                                 |
| `subset`                                  | `{ kind: "subset", left, right }`         | Every element of `left` appears in `right`.                                                    |
| `contains`                                | `{ kind: "contains", collection, value }` | `value` appears in `collection`.                                                               |
| `exists`                                  | `{ kind: "exists", target }`              | `target` did not resolve to the missing sentinel.                                              |
| `isType`                                  | `{ kind: "isType", target, type }`        | `target`'s JSON type (`null`\|`boolean`\|`number`\|`string`\|`array`\|`object`) equals `type`. |
| `all` / `any`                             | `{ kind, operands: [...] }`               | Boolean AND/OR over up to `maxOperands` operands.                                              |
| `not`                                     | `{ kind: "not", operand }`                | Boolean negation.                                                                              |
| `if`                                      | `{ kind: "if", condition, then, else }`   | Selects `then` or `else` by `condition`.                                                       |

A rule's top-level `assert` must compile to one of the boolean-producing kinds (everything
except `literal`/`path`/`select`/`count`) so it can never be silently truthy-coerced. Every
missing value resolves to an explicit sentinel and every type mismatch fails closed to
`false`/not-matched -- never a thrown exception from evaluating candidate-shaped data. Depth,
total node count, and `all`/`any` operand count are all bounded (see
[`packages/core/src/limits.ts`](../packages/core/src/limits.ts)'s `maxExprDepth`/
`maxExprNodes`/`maxExprOperands`).

Example -- a cross-field count invariant:

```yaml
invariants:
  - id: total-observations-match
    assert:
      kind: eq
      left: { kind: path, pointer: /summary/totalObservations }
      right:
        kind: count
        of: { kind: select, selector: /observations/* }
```

## `checks[]`

One check runs one contract against one source, with an optional retry policy.

```yaml
checks:
  - id: my-check # unique
    contract: my-contract # must reference a declared contracts[].id
    source: { ... } # "artifacts" or "command", see below
    retries:
      maxAttempts: 1 # 1-5, default 1
      delayMs: 0 # 0-60000ms between attempts, default 0
```

### `source.kind: artifacts`

Reads one or more already-recorded files, each either a `raw` single-attempt file or a
schema-validated `envelope` (an ordered list of attempts; see
[`schemas/axiom-artifact.v1.schema.json`](../schemas/axiom-artifact.v1.schema.json) and
[`docs/report-format.md`](report-format.md)'s note on the `json` vs. envelope-error
distinction).

```yaml
source:
  kind: artifacts
  items:
    - id: my-case # unique per check
      path: cases/my-case.json
      format: raw # or "envelope"
```

### `source.kind: command`

Runs one configured executable and treats its captured stdout as the candidate content for a
single live case. **Requires explicit consent**: `--allow-command` for the CLI, or
`allow-command: true` for the Action -- a config that declares a command source without that
consent is exit `2`, and axiom never spawns anything on its own initiative. See
[`docs/threat-model.md`](threat-model.md)'s "command execution is not a sandbox" section.

```yaml
source:
  kind: command
  executable: /usr/local/bin/my-extractor
  args: ['--flag', 'value'] # optional, up to 256 entries
  cwd: some/contained/dir # optional, defaults to the config directory
  timeoutMs: 30000 # required, 1-300000
  maxStdoutBytes: 1048576 # required, 1-2097152
  maxStderrBytes: 16384 # required, 1-65536
  env: ['MY_ALLOWED_VAR'] # optional allowlist of names copied from the ambient env
```

Only `spawn` (`shell: false`) is used, so no shell metacharacter in `executable`/`args` is
ever interpreted; stdin is closed immediately; `env` is an **allowlist of names**, never a
merge with the ambient environment; stdout/stderr are drained concurrently against
independent byte caps; exceeding either cap, exceeding `timeoutMs`, or a non-zero
exit/signal all terminate the **entire process tree** (not just the direct child) and
surface as a tooling failure (exit `3`), never a retryable candidate failure. Only a
successfully-captured attempt that then fails contract evaluation is eligible for a retry.

## `baseline` (required only for `axiom compare`)

```yaml
baseline:
  report: baseline/baseline-report.json # a committed axiom-report.v1 JSON file
  population: comparable # "exact" | "comparable"
  thresholds:
    - metric: finalPassRate # one of the metric ids in docs/report-format.md
      direction: max-decrease # "max-decrease" | "max-increase" | "min-value" | "max-value"
      amount: '0.10' # required, an exact fixed-decimal string (never a float)
      minDenominator: 1 # optional, default 1
```

- `population: comparable` requires the current and baseline reports to cover the same _set_
  of check ids; `population: exact` additionally requires an identical
  `populationFingerprint` (the same cases, byte-for-byte). See
  [ADR 0004](adr/0004-exact-baseline-comparison.md).
- Every threshold's `amount`/comparison is exact `BigInt` fraction arithmetic
  ([`packages/core/src/engine/decimal.ts`](../packages/core/src/engine/decimal.ts)), never a
  binary float -- `0.1` and `1/3` never round-trip through IEEE-754 in a way that could flip
  a pass/fail decision at a boundary.
- A threshold whose metric is absent from either report, or whose current/baseline
  denominator falls below `minDenominator`, resolves to `"insufficient-data"` -- not a
  silent pass and not a silent fail.
- The report's own `comparison.baselineReportPath` field always stores `baseline.report`
  exactly as configured (a config-relative path), never the resolved absolute filesystem
  path -- so the same config/fixtures produce a byte-identical report on any machine.

## `reports`

```yaml
reports:
  json: .axiom/reports/current.json
  markdown: .axiom/reports/current.md
```

Both targets go through the same real-path/symlink-contained write path
([`writeReportOutputs`](../packages/core/src/engine/workflow.ts)) regardless of which command
produced them.

## `redaction` (optional)

Applied, in order, to every finding's `pointer`/`ruleId`/`code` before it is ever written to a
report, in addition to being applied once already at the point each finding is created (a
belt-and-suspenders defensive pass; see [`docs/threat-model.md`](threat-model.md)).

```yaml
redaction:
  paths: ['/observations/*/token'] # bounded selectors; a matching pointer becomes "[redacted]"
  patterns:
    - id: no-api-keys
      pattern: 'sk-[A-Za-z0-9]+'
      flags: []
```

A finding's `ruleId` is constrained by the report schema to
`^[A-Za-z][A-Za-z0-9_-]{0,63}$`; redacting it replaces the _entire_ identifier with the
schema-valid placeholder `redacted` rather than splicing the bracketed `[redacted]` value
placeholder into the middle of it (which would otherwise produce a report that fails its own
schema -- see [`packages/core/src/redaction/redact.ts`](../packages/core/src/redaction/redact.ts)'s
`redactId`).

## Compiled-in ceilings

Every numeric bound in this document mirrors a hard, compiled-in ceiling in
[`packages/core/src/limits.ts`](../packages/core/src/limits.ts) (`DEFAULT_LIMITS`). A config
may only ever _lower_ one of these bounds (e.g. a smaller `maxStdoutBytes`); `compileConfig`
rejects any configured value that would exceed its `DEFAULT_LIMITS` counterpart.
