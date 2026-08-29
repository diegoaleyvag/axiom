import type { CompiledRedactionPattern } from '../redaction/patterns.js';
import type { Expr } from '../invariant/ast.js';
import type { SelectorSegment } from '../invariant/pointer.js';
import type { RegExpLike } from '../schema/regex-engine.js';
import type { ThresholdDirection } from './config.js';

/**
 * The fully semantically-compiled config model: every ID cross-reference resolved and
 * validated, every path resolved (syntactically -- see `../config/paths.js`) to an
 * absolute path under the config root, every invariant/policy expression compiled to the
 * closed {@link Expr} AST, and every pattern pre-compiled through the bounded RE2 adapter.
 * This is what the (not-yet-implemented) evaluation engine and CLI/Action adapters
 * consume; nothing downstream should ever re-parse the raw YAML.
 */

export interface CompiledForbiddenPathRule {
  readonly id: string;
  readonly segments: readonly SelectorSegment[];
}

export interface CompiledForbiddenPatternRule {
  readonly id: string;
  readonly segments: readonly SelectorSegment[];
  readonly target: 'stringValues' | 'keys';
  readonly matcher: RegExpLike;
}

export interface CompiledInvariantRule {
  readonly id: string;
  readonly assert: Expr;
}

export interface CompiledContract {
  readonly id: string;
  readonly schemaRootPath: string;
  readonly schemaResourcePaths: readonly string[];
  readonly invariants: readonly CompiledInvariantRule[];
  readonly forbiddenPaths: readonly CompiledForbiddenPathRule[];
  readonly forbiddenPatterns: readonly CompiledForbiddenPatternRule[];
}

export interface CompiledArtifactSourceItem {
  readonly id: string;
  readonly path: string;
  readonly format: 'raw' | 'envelope';
}

export interface CompiledArtifactSource {
  readonly kind: 'artifacts';
  readonly items: readonly CompiledArtifactSourceItem[];
}

export interface CompiledCommandSource {
  readonly kind: 'command';
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly env: readonly string[];
}

export type CompiledSource = CompiledArtifactSource | CompiledCommandSource;

export interface CompiledRetryConfig {
  readonly maxAttempts: number;
  readonly delayMs: number;
}

export interface CompiledCheck {
  readonly id: string;
  readonly contractId: string;
  readonly source: CompiledSource;
  readonly retries: CompiledRetryConfig;
}

export interface CompiledBaselineThreshold {
  readonly metric: string;
  readonly direction: ThresholdDirection;
  /** Exact decimal string, required (see `../config/compile.js`): every direction needs a bound. */
  readonly amount: string;
  readonly minDenominator: number;
}

export interface CompiledBaseline {
  readonly reportPath: string;
  /**
   * The `baseline.report` path exactly as authored in the config (relative to `configDir`,
   * never resolved to an absolute filesystem path). Used only for display, in
   * {@link import('./report.js').ComparisonReport.baselineReportPath} -- the absolute
   * {@link reportPath} is a real filesystem detail of *this* machine/checkout and must never
   * leak into a committed/compared report, which would otherwise make every report
   * non-reproducible across machines despite being built from byte-identical inputs.
   */
  readonly reportPathRelative: string;
  readonly population: 'exact' | 'comparable';
  readonly thresholds: readonly CompiledBaselineThreshold[];
}

export interface CompiledReports {
  readonly jsonPath: string;
  readonly markdownPath: string;
}

export interface CompiledRedaction {
  readonly pathSegments: readonly (readonly SelectorSegment[])[];
  readonly patterns: readonly CompiledRedactionPattern[];
}

export interface CompiledAxiomConfig {
  readonly version: 1;
  readonly configPath: string;
  readonly configDir: string;
  readonly contracts: ReadonlyMap<string, CompiledContract>;
  readonly checks: ReadonlyMap<string, CompiledCheck>;
  readonly baseline?: CompiledBaseline;
  readonly reports: CompiledReports;
  readonly redaction: CompiledRedaction;
}
