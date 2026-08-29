// Public surface of @axiom/core. CLI and Action adapters must only ever depend on what is
// exported here -- never on a deep `@axiom/core/src/...` import -- so this module is the
// one place the package boundary between "shared engine" and "adapters" is enforced.

export * from './domain/json.js';
export * from './domain/config.js';
export * from './domain/compiled-config.js';
export * from './domain/artifact.js';
export * from './domain/report.js';

export * from './errors.js';
export * from './exit-code.js';
export * from './limits.js';

export * from './runtime/ports.js';
export { createNodeFileSystem, isEnoentError } from './runtime/node-filesystem.js';

export * from './json/safe-object.js';
export * from './json/decode.js';

export * from './config/paths.js';
export * from './config/decode.js';
export * from './config/validate.js';
export * from './config/compile.js';
export * from './config/load.js';

export * from './invariant/ast.js';
export * from './invariant/pointer.js';
export * from './invariant/compile.js';

export type { RegExpLike, AjvRegExpEngine, BoundedPatternOptions } from './schema/regex-engine.js';
export { compileBoundedPattern, createAjvRegExpEngine } from './schema/regex-engine.js';
export { createAjv } from './schema/ajv-factory.js';
export type { AjvFactoryOptions } from './schema/ajv-factory.js';

export * from './redaction/patterns.js';
export * from './redaction/redact.js';

export * from './version.js';

export * from './engine/values.js';
export * from './engine/path-resolve.js';
export * from './engine/json-equal.js';
export * from './engine/invariant-eval.js';
export * from './engine/finding.js';
export * from './engine/redact-pointer.js';
export * from './engine/safe-pointer.js';
export * from './engine/policy.js';
export * from './engine/decimal.js';
export * from './engine/case.js';
export * from './engine/schema-cache.js';
export * from './engine/evaluate-attempt.js';
export * from './engine/validate-artifact.js';
export * from './engine/validate-report.js';
export * from './engine/sources/artifact-source.js';
export * from './engine/sources/command-source.js';
export * from './engine/run-case.js';
export * from './engine/run-check.js';
export * from './engine/metrics.js';
export * from './engine/fingerprint.js';
export * from './engine/compare.js';
export * from './engine/build-report.js';
export * from './engine/redact-report.js';
export * from './engine/render/json.js';
export * from './engine/render/markdown.js';
export * from './engine/run-config.js';
export * from './engine/workflow.js';

export { createNodeProcess } from './runtime/node-process.js';
