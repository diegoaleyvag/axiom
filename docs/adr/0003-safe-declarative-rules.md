# ADR 0003: A closed declarative rule grammar -- no `eval`, no JSONPath filters, no templates

## Status

Accepted.

## Context

Contract validation beyond plain JSON Schema needs cross-field logic: "the count field must
equal the number of items in this array," "this field must be absent," "this string pattern
must never appear here." The easy way to add that kind of expressiveness to a config format
is to accept a snippet of a real expression language -- a JavaScript expression, a JSONPath
filter expression (`?(@.foo > @.bar)`), or a template string later interpolated and
evaluated. All three are effectively unbounded code-execution surfaces once fed
attacker-influenced data: a config value is operator-authored, but it is evaluated against
candidate data (`packages/core/src/engine/evaluate-attempt.ts`) that is explicitly _not_
trusted, and in a CI context the config itself may be attacker-influenced too (a pull request
proposing a config change). A snippet-evaluation approach also makes total termination and
determinism hard to guarantee: what happens if the snippet loops forever, throws, or reads
`process.env`?

## Decision

Invariant and forbidden-path/pattern rules are exactly one thing: a node in a small, closed,
declarative expression AST
([`packages/core/src/invariant/ast.ts`](../../packages/core/src/invariant/ast.ts)). Every
`kind` (`literal`, `path`, `select`, `count`, the comparison/set/presence/type operators,
`all`/`any`/`not`/`if`) is explicitly enumerated; an unknown `kind` is a compile-time
`ConfigError`, not silently ignored or passed through to some fallback interpreter. There is
no `eval`, no `Function` constructor, no JSONPath filter expression syntax, and no template
string interpolation anywhere in the grammar or its compiler
([`packages/core/src/invariant/compile.ts`](../../packages/core/src/invariant/compile.ts)).

Evaluating a compiled expression against candidate data
([`packages/core/src/engine/invariant-eval.ts`](../../packages/core/src/engine/invariant-eval.ts))
is **total**: a missing value resolves to an explicit sentinel, a type mismatch fails closed
to `false`/not-matched, and depth/node/operand counts are bounded at compile time
(`maxExprDepth`/`maxExprNodes`/`maxExprOperands` in
[`limits.ts`](../../packages/core/src/limits.ts)) -- there is no way to construct a rule that
loops, recurses unboundedly, or throws when evaluated against arbitrarily-shaped candidate
JSON. `evaluate-attempt.test.ts`'s property test exercises this directly: for any bounded
candidate content (including hand-picked near-misses at the schema/invariant/policy
boundaries), evaluating a non-trivial contract never throws and is fully deterministic on
repeat evaluation.

## Consequences

- **Positive:** the entire space of expressible rules is statically enumerable. A security
  reviewer can read one file (`ast.ts`) and know the complete set of things a config can ever
  cause to happen during evaluation -- there is no escape hatch to audit separately.
- **Positive:** totality is a property of the grammar, not a defensive try/catch wrapped
  around every rule evaluation. That is what makes "the engine never throws for a problem
  intrinsic to candidate content" a checkable guarantee rather than a best-effort one.
- **Negative:** the grammar is genuinely less expressive than a real scripting language. A
  rule that needs, say, a regular string transformation before comparison, or arithmetic
  beyond equality/ordering, cannot currently be expressed. Extending the grammar (a new
  `kind`) is a deliberate, reviewed addition to a closed enum -- not a config-author's choice
  at use time -- by design.
- **Negative:** selectors support only one level of `*` wildcard expansion per segment (no
  recursive/multi-level wildcard), which is a deliberate boundedness trade-off (see
  [`packages/core/src/invariant/pointer.ts`](../../packages/core/src/invariant/pointer.ts))
  rather than a grammar limitation that will be lifted later without also solving the
  unbounded-expansion problem it currently avoids.
