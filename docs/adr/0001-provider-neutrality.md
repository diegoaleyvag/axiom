# ADR 0001: Provider neutrality -- no token, no provider SDK, no network access

## Status

Accepted.

## Context

Axiom validates structured AI outputs as software contracts. Many comparable tools in this
space couple themselves to a specific model provider's SDK, require an API token, or phone
home for telemetry/licensing. That coupling has real costs for exactly the use case Axiom
targets:

- A CI gate that requires a live network call to a provider is not reproducible offline, is
  vulnerable to provider outages/rate limits unrelated to the change being validated, and
  requires a secret to exist in every environment that runs it (including, dangerously,
  pull-request CI from forks).
- A tool coupled to one provider's output conventions cannot validate another provider's
  output, or a locally fine-tuned model's output, or a hand-authored fixture, without being
  rewritten.
- A contract-validation tool that itself requires a credential expands exactly the secret
  surface it exists to help audit.

## Decision

Axiom takes **no provider SDK, no API token, and makes no network call** anywhere in its
normal operation. It has exactly two input modes, both already-materialized data the
operator controls:

1. **Artifacts** -- files already on disk (a raw candidate file, or a provider-neutral
   recorded envelope of ordered attempts).
2. **Command** -- a locally-run, explicitly-consented executable whose captured stdout is
   the candidate content.

Both modes produce the same shape (`EngineCase`, an ordered list of raw attempt content
strings) before evaluation ever begins, so the single evaluation engine
([ADR 0002](0002-shared-engine.md)) never needs to know or care which provider (if any)
originally generated the content, or whether it was recorded minutes or months ago.

Schema compilation ([`ajv-factory.ts`](../../packages/core/src/schema/ajv-factory.ts))
explicitly disables `$data` references and configures no `loadSchema`, so it can never
trigger a network fetch. No package in this workspace depends on any provider's client
library.

## Consequences

- **Positive:** fully offline CI runs, no secret required anywhere in the default path, no
  vendor lock-in, and the same engine validates output from any source that can produce
  either a recorded artifact or a local command's stdout.
- **Positive:** the recorded-artifact envelope
  ([`schemas/axiom-artifact.v1.schema.json`](../../schemas/axiom-artifact.v1.schema.json)) is
  itself provider-neutral -- an ordered list of raw attempt text -- so switching providers,
  or re-running against historically recorded output, requires no config change beyond
  pointing at different files.
- **Negative:** Axiom does not (and will not) provide a built-in "call this model and record
  its output" convenience step. That is explicitly the operator's responsibility, upstream of
  Axiom; Axiom only ever consumes the result.
- **Negative:** a "command" source that itself calls out to a provider inherits that
  provider's trust/availability/cost characteristics -- but that is the _command's_ behavior,
  not something Axiom re-implements or hides (see
  [`docs/threat-model.md`](../threat-model.md)'s "command execution is not a sandbox").
