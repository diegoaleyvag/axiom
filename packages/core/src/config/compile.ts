import path from 'node:path';
import type {
  AxiomConfigFileV1,
  RawBaselineConfig,
  RawCheckConfig,
  RawContractConfig,
  RawRedactionConfig,
  RawReportsConfig,
  RawSourceConfig,
} from '../domain/config.js';
import type {
  CompiledAxiomConfig,
  CompiledBaseline,
  CompiledCheck,
  CompiledContract,
  CompiledReports,
  CompiledRedaction,
  CompiledRetryConfig,
  CompiledSource,
} from '../domain/compiled-config.js';
import type { JsonValue } from '../domain/json.js';
import { METRIC_IDS, type MetricId } from '../domain/report.js';
import { ConfigError } from '../errors.js';
import { parseExactDecimalOrThrow } from '../engine/decimal.js';
import { BOOLEAN_EXPR_KINDS } from '../invariant/ast.js';
import { compileExpr, type CompileExprLimits } from '../invariant/compile.js';
import { parseSelector, type SelectorLimits } from '../invariant/pointer.js';
import { DEFAULT_LIMITS } from '../limits.js';
import { compileRedactionPattern } from '../redaction/patterns.js';
import { compileBoundedPattern } from '../schema/regex-engine.js';
import { resolveConfigRelativePath } from './paths.js';

const SELECTOR_LIMITS: SelectorLimits = {
  maxSegments: DEFAULT_LIMITS.maxPointerSegments,
  maxSegmentLength: DEFAULT_LIMITS.maxPointerSegmentLength,
  maxWildcards: DEFAULT_LIMITS.maxSelectorWildcards,
};

const EXPR_LIMITS: CompileExprLimits = {
  ...SELECTOR_LIMITS,
  maxDepth: DEFAULT_LIMITS.maxExprDepth,
  maxNodes: DEFAULT_LIMITS.maxExprNodes,
  maxOperands: DEFAULT_LIMITS.maxExprOperands,
};

const PATTERN_LIMITS = { maxPatternLength: DEFAULT_LIMITS.maxPatternLength };

function assertUniqueIds(ids: readonly string[], kind: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new ConfigError('config.duplicate-id', `Duplicate ${kind} id "${id}".`);
    }
    seen.add(id);
  }
}

/**
 * Semantically compiles an already schema-validated {@link AxiomConfigFileV1} (see
 * `./validate.js`) into the fully-resolved {@link CompiledAxiomConfig} the (not yet
 * implemented) evaluation engine and CLI/Action adapters will consume.
 *
 * This step performs no I/O: every path is only syntactically resolved (see
 * `./paths.js`), never read, following the plan's phase order --
 * decode → validate → compile is complete before any referenced schema, artifact,
 * baseline, or command is ever touched.
 *
 * Catches what JSON Schema structurally cannot: duplicate IDs within an array (Ajv's
 * `uniqueItems` only compares whole items, not one sub-field), unresolved cross-references
 * (`checks[].contract` naming a contract that does not exist), and the full closed
 * invariant/policy expression grammar (see `../invariant/compile.js`).
 */
export function compileConfig(raw: AxiomConfigFileV1, configPath: string): CompiledAxiomConfig {
  const configDir = path.dirname(configPath);

  assertUniqueIds(
    raw.contracts.map((contract) => contract.id),
    'contract',
  );
  const contracts = new Map<string, CompiledContract>();
  for (const rawContract of raw.contracts) {
    contracts.set(rawContract.id, compileContract(rawContract, configDir));
  }

  assertUniqueIds(
    raw.checks.map((check) => check.id),
    'check',
  );
  const checks = new Map<string, CompiledCheck>();
  for (const rawCheck of raw.checks) {
    if (!contracts.has(rawCheck.contract)) {
      throw new ConfigError(
        'config.unknown-reference',
        `Check "${rawCheck.id}" references unknown contract "${rawCheck.contract}".`,
      );
    }
    checks.set(rawCheck.id, compileCheck(rawCheck, configDir));
  }

  const baseline = raw.baseline ? compileBaseline(raw.baseline, configDir) : undefined;
  const reports = compileReports(raw.reports, configDir);
  const redaction = compileRedaction(raw.redaction);

  return {
    version: 1,
    configPath,
    configDir,
    contracts,
    checks,
    ...(baseline ? { baseline } : {}),
    reports,
    redaction,
  };
}

function compileContract(raw: RawContractConfig, configDir: string): CompiledContract {
  const schemaRootPath = resolveConfigRelativePath(
    configDir,
    raw.schema.root,
    `contracts.${raw.id}.schema.root`,
  );
  const schemaResourcePaths = (raw.schema.resources ?? []).map((resource, index) =>
    resolveConfigRelativePath(
      configDir,
      resource,
      `contracts.${raw.id}.schema.resources[${index}]`,
    ),
  );

  const invariantRules = raw.invariants ?? [];
  assertUniqueIds(
    invariantRules.map((rule) => rule.id),
    `invariant (contract "${raw.id}")`,
  );
  const invariants = invariantRules.map((rule) => {
    const assert = compileExpr(rule.assert as JsonValue, EXPR_LIMITS);
    if (!BOOLEAN_EXPR_KINDS.has(assert.kind)) {
      throw new ConfigError(
        'config.invariant-not-boolean',
        `Invariant "${rule.id}" (contract "${raw.id}") must assert a boolean-producing expression, not "${assert.kind}".`,
      );
    }
    return { id: rule.id, assert };
  });

  const forbiddenPathRules = raw.forbidden?.paths ?? [];
  assertUniqueIds(
    forbiddenPathRules.map((rule) => rule.id),
    `forbidden path (contract "${raw.id}")`,
  );
  const forbiddenPaths = forbiddenPathRules.map((rule) => ({
    id: rule.id,
    segments: parseSelector(rule.selector, SELECTOR_LIMITS),
  }));

  const forbiddenPatternRules = raw.forbidden?.patterns ?? [];
  assertUniqueIds(
    forbiddenPatternRules.map((rule) => rule.id),
    `forbidden pattern (contract "${raw.id}")`,
  );
  const forbiddenPatterns = forbiddenPatternRules.map((rule) => ({
    id: rule.id,
    segments: parseSelector(rule.selector, SELECTOR_LIMITS),
    target: rule.target,
    matcher: compileBoundedPattern(rule.pattern, (rule.flags ?? []).join(''), PATTERN_LIMITS),
  }));

  return {
    id: raw.id,
    schemaRootPath,
    schemaResourcePaths,
    invariants,
    forbiddenPaths,
    forbiddenPatterns,
  };
}

function compileCheck(raw: RawCheckConfig, configDir: string): CompiledCheck {
  const retries: CompiledRetryConfig = {
    maxAttempts: raw.retries?.maxAttempts ?? 1,
    delayMs: raw.retries?.delayMs ?? 0,
  };
  return {
    id: raw.id,
    contractId: raw.contract,
    source: compileSource(raw.source, configDir, raw.id),
    retries,
  };
}

function compileSource(raw: RawSourceConfig, configDir: string, checkId: string): CompiledSource {
  if (raw.kind === 'artifacts') {
    assertUniqueIds(
      raw.items.map((item) => item.id),
      `artifact item (check "${checkId}")`,
    );
    const items = raw.items.map((item, index) => ({
      id: item.id,
      path: resolveConfigRelativePath(
        configDir,
        item.path,
        `checks.${checkId}.source.items[${index}].path`,
      ),
      format: item.format,
    }));
    return { kind: 'artifacts', items };
  }

  const cwd = raw.cwd
    ? resolveConfigRelativePath(configDir, raw.cwd, `checks.${checkId}.source.cwd`)
    : configDir;

  return {
    kind: 'command',
    executable: raw.executable,
    args: raw.args ?? [],
    cwd,
    timeoutMs: raw.timeoutMs,
    maxStdoutBytes: raw.maxStdoutBytes,
    maxStderrBytes: raw.maxStderrBytes,
    env: raw.env ?? [],
  };
}

function compileBaseline(raw: RawBaselineConfig, configDir: string): CompiledBaseline {
  const reportPath = resolveConfigRelativePath(configDir, raw.report, 'baseline.report');
  const thresholds = raw.thresholds.map((threshold) => {
    if (!(METRIC_IDS as readonly string[]).includes(threshold.metric)) {
      throw new ConfigError(
        'config.unknown-metric',
        `Unknown baseline threshold metric "${threshold.metric}".`,
      );
    }
    // Every direction (a decrease/increase delta, or a value floor/ceiling) is meaningless
    // without a bound: the schema leaves `amount` optional only because it is shared across
    // directions with different semantics, so the requirement is enforced here instead.
    if (threshold.amount === undefined) {
      throw new ConfigError(
        'config.threshold-missing-amount',
        `Baseline threshold for metric "${threshold.metric}" must specify "amount".`,
      );
    }
    parseExactDecimalOrThrow(threshold.amount, `baseline threshold "${threshold.metric}" amount`);
    return {
      metric: threshold.metric as MetricId,
      direction: threshold.direction,
      amount: threshold.amount,
      minDenominator: threshold.minDenominator ?? 1,
    };
  });
  return { reportPath, reportPathRelative: raw.report, population: raw.population, thresholds };
}

function compileReports(raw: RawReportsConfig, configDir: string): CompiledReports {
  return {
    jsonPath: resolveConfigRelativePath(configDir, raw.json, 'reports.json'),
    markdownPath: resolveConfigRelativePath(configDir, raw.markdown, 'reports.markdown'),
  };
}

function compileRedaction(raw: RawRedactionConfig | undefined): CompiledRedaction {
  const pathSegments = (raw?.paths ?? []).map((selector) =>
    parseSelector(selector, SELECTOR_LIMITS),
  );

  const patternRules = raw?.patterns ?? [];
  assertUniqueIds(
    patternRules.map((rule) => rule.id),
    'redaction pattern',
  );
  const patterns = patternRules.map((rule) =>
    compileRedactionPattern(rule.pattern, rule.flags ?? [], PATTERN_LIMITS),
  );

  return { pathSegments, patterns };
}
