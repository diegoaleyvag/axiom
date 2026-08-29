# Threat model

Axiom evaluates untrusted, potentially adversarial candidate data (AI-generated JSON, or the
stdout of a locally-run command) against a config the operator controls. This document lists
the threats considered, the controls in place, and what is explicitly out of scope.

## Trust boundaries

| Input                                                                                                  | Trust level                                                                                                                  | Notes                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `axiom.config.yaml` and everything it references (schemas, artifacts, baseline reports)                | Operator-controlled, but may itself be attacker-influenced in a CI context (e.g. a config change proposed in a pull request) | Fully validated: bounded YAML/JSON decode, schema validation, semantic compilation, and real-path/symlink containment, all _before_ any referenced file is read or any command is spawned.                         |
| Candidate content (an artifact's `attempts[].content`, or a command's captured stdout)                 | Fully adversarial                                                                                                            | Never trusted to be valid JSON, well-typed, or bounded in structure independent of the document's overall byte size; every stage that touches it is total (never throws) and produces stable, value-free findings. |
| A configured command's executable/args/env/cwd                                                         | Operator-controlled, requires explicit consent                                                                               | See "Command execution is not a sandbox" below.                                                                                                                                                                    |
| An externally-supplied report file (`axiom report --report <path>`, or a configured `baseline.report`) | Not necessarily produced by this process                                                                                     | Always fully revalidated against `schemas/axiom-report.v1.schema.json`, never trusted.                                                                                                                             |

## Controls

### 1. Phase order: decode -> validate -> compile -> evaluate

`loadConfig` ([`packages/core/src/config/load.ts`](../packages/core/src/config/load.ts))
reads and validates _only_ the config file itself; no referenced schema, artifact, baseline,
or command is ever touched until compilation succeeds. This is a checked property, not just a
convention: `packages/core/src/config/phase-order.test.ts` asserts that an invalid config
performs no referenced-file access, report write, or process spawn.

### 2. Bounded, non-mutating decode everywhere

- **YAML** ([`decode.ts`](../packages/core/src/config/decode.ts)): YAML 1.2 core schema, no
  merge keys, no implicit tag resolution, no custom tags, duplicate keys rejected, every
  anchor/alias rejected outright (`maxAliasCount: 0`, closing both "billion laughs" and
  aliasing confusion), every parse _warning_ escalated to a hard failure.
- **JSON** ([`decode.ts`](../packages/core/src/json/decode.ts)): duplicate keys rejected,
  numbers that cannot round-trip exactly through IEEE-754 rejected (fail-closed, never
  silently truncated), byte/depth/node ceilings enforced before and during parsing.
- **Prototype pollution**
  ([`safe-object.ts`](../packages/core/src/json/safe-object.ts)): `__proto__`,
  `constructor`, and `prototype` are rejected as object keys anywhere in a decoded graph,
  even though `JSON.parse` itself cannot be tricked into reassigning
  `Object.prototype` this way -- defense in depth against any future decode path that might
  not share that guarantee.

### 3. Real-path/symlink containment for every referenced file

`resolveConfigRelativePath` ([`packages/core/src/config/paths.ts`](../packages/core/src/config/paths.ts))
syntactically resolves every configured path (schema root/resources, artifact item paths,
`baseline.report`, `reports.json`/`reports.markdown`) against the config directory with no
I/O, rejecting absolute/home-relative/drive-letter/UNC paths, `.`/`..` segments, and anything
that would lexically escape the root.

That alone is not sufficient: a syntactically-contained path can still be a symlink pointing
outside the config root, planted after config compilation but before the file is actually
opened. `assertRealPathContained` closes that gap by resolving symlinks through the injected
filesystem port and re-verifying containment against the **real** path, immediately before
each read:

- Schema root/resources and every artifact item's path (verified as a batch, up front, in
  [`runAllChecks`](../packages/core/src/engine/run-config.ts), before any of them is opened).
- The configured `baseline.report`, before `axiom compare` reads it
  ([`workflow.ts`](../packages/core/src/engine/workflow.ts)).
- Every configured report output target, before it is written
  (`writeReportOutputs`, same module) -- write targets that do not exist yet are handled by
  walking up to the nearest existing ancestor directory and verifying _that_ real path, so a
  symlinked ancestor cannot be used to escape the root merely because the leaf file has not
  been created.

`packages/core/src/engine/run-config.test.ts` and
`packages/core/src/config/paths.test.ts` cover this with real symlinks against a real
filesystem (not a fake), including the write-target-ancestor case.

### 4. Command execution is not a sandbox

Command-source checks require **explicit consent** (`--allow-command` / `allow-command:
true`) and are documented, not sandboxed: axiom does not attempt to restrict what a
consented, correctly-argued command can do to the filesystem or network once it starts. What
axiom _does_ guarantee about how it invokes that command
([`packages/core/src/runtime/node-process.ts`](../packages/core/src/runtime/node-process.ts),
exercised against real OS processes in
`packages/core/src/runtime/node-process.test.ts`):

- `spawn` with `shell: false` -- argv reaches `execve` directly; no shell metacharacter
  (`;`, `|`, `` ` ``, `$()`, ...) in `executable`/`args` is ever interpreted.
- stdin is closed immediately (`stdio: ['ignore', ...]`) -- a child can never block this
  process waiting for input that will never arrive.
- `env` is the check's configured allowlist, copied from the ambient environment by name and
  used **verbatim** as the entire child environment -- never merged with the parent's.
- A hard wall-clock timeout and independent stdout/stderr byte caps; exceeding either
  terminates the **whole process tree** (the child's process group, not only the direct
  child), so a child that forks its own subprocess cannot outlive the configured limits.
- Only a captured attempt that then fails _contract_ evaluation is retried; a timeout,
  output overflow, non-zero exit, or signal is always a tooling failure (exit `3`),
  immediately, never retried as if it were a candidate failure.

### 5. Closed declarative rule grammar (no code execution)

Invariant and forbidden-path/pattern rules are the closed AST documented in
[`docs/configuration.md`](configuration.md) and
[ADR 0003](adr/0003-safe-declarative-rules.md): there is no JavaScript, JSONPath filter,
template string, or `eval` anywhere in the grammar. A config cannot smuggle executable logic
into a rule; every `kind` is explicitly enumerated and unknown kinds are rejected at compile
time.

### 6. Bounded, backtracking-free pattern matching

Every `pattern` (JSON Schema `pattern`/`patternProperties`, `forbidden.patterns[].pattern`,
`redaction.patterns[].pattern`) is compiled through one RE2 adapter
([`packages/core/src/schema/regex-engine.ts`](../packages/core/src/schema/regex-engine.ts)),
never native backtracking `RegExp`. RE2 matches in time linear in the input length
regardless of the pattern, so no pattern -- however an operator writes it -- can cause
catastrophic backtracking against attacker-controlled candidate data. Pattern source length
is capped independently of RE2's own guarantees.

### 7. Value-free reports and defense-in-depth redaction

A report's `Finding` never carries the candidate value, a raw Ajv error's `data`/`params`,
or captured stdout/stderr -- only a stable code/category, a sanitized pointer, and
rule/check/case identifiers (see [`docs/report-format.md`](report-format.md)). On top of
that structural guarantee:

- A candidate-derived pointer segment (an Ajv `instancePath` segment, or a raw object key
  matched by a `forbidden.patterns[].target: keys` rule) is bounded to a fixed maximum
  length before it is ever formatted into a report pointer
  ([`packages/core/src/engine/safe-pointer.ts`](../packages/core/src/engine/safe-pointer.ts)'s
  `boundCandidateSegment`) -- a candidate document's individual key names are not bounded in
  length by the document's overall byte/depth/node caps, so an unbounded key could otherwise
  consume most of a report.
- Configured redaction paths/patterns are applied once at the point a finding's pointer is
  created ([`redact-pointer.ts`](../packages/core/src/engine/redact-pointer.ts)), and again,
  defensively, over the fully-assembled report immediately before every render
  ([`redact-report.ts`](../packages/core/src/engine/redact-report.ts)) -- including
  `axiom report`'s re-render of a report this process did not itself produce.
- Markdown rendering ([`render/markdown.ts`](../packages/core/src/engine/render/markdown.ts))
  independently escapes every candidate-influenced cell against table-delimiter injection
  (`|`), inline-code-span breakout (`` ` ``), raw HTML/script injection (`<`/`>` entity
  escaping), and embedded control characters/newlines (stripped/collapsed), and caps cell
  length -- the last point before the report leaves the process, not the first point of
  validation.
- The greenhouse-inspection example plants synthetic secret canaries
  (`AXIOM_SYNTHETIC_SECRET_*`) specifically to prove no report/log/annotation/snapshot ever
  contains one; see `examples/greenhouse-inspection/greenhouse.test.ts` and
  `packages/action/src/index.test.ts`'s "secret safety" tests.

### 8. Crash-vs-finding classification

Every anticipated failure extends `AxiomError` and carries a pinned exit code (`2` or `3`);
anything else -- a genuine programming mistake, a native exception -- maps to exit `3`
(`exitCodeForError`, [`packages/core/src/exit-code.ts`](../packages/core/src/exit-code.ts)).
This closes a specific trap: Node's default behavior for an uncaught exception/unhandled
rejection must never be mistaken for exit `1` ("a contract violation was found"), which would
otherwise let a genuine crash silently masquerade as "the input just failed its contract."

## Explicitly out of scope

- **Command execution is not a sandbox.** See above -- axiom does not provide process
  isolation, filesystem/network restriction, or resource limiting beyond timeout/output caps
  for a consented command's own behavior once it starts.
- **SARIF output is deferred.** See [`HANDOFF.md`](../HANDOFF.md).
- **No secrets management.** Axiom takes no token and no credential of any kind; there is
  nothing to leak because there is nothing to hold.
- **No network access in normal operation.** Schema compilation has no remote `$ref`
  resolution and no `$data`; nothing in `packages/core` makes an outbound network call. A
  _consented_ command source could itself make network calls -- that is the command's
  behavior, not axiom's.
