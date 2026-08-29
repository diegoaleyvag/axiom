/**
 * The `axiom.config.yaml` shape, decoded and Ajv-validated against
 * `schemas/axiom-config.v1.schema.json` but not yet semantically compiled (see
 * `../config/compile.js` for the compiled model). Field shapes mirror the schema
 * one-to-one; `invariants[].assert`/`forbidden.patterns[]`/`redaction.patterns[]` bodies
 * are only loosely typed here (as `unknown`) because the schema intentionally does not
 * encode the full recursive expression grammar -- `../invariant/compile.js` is the single
 * place that grammar is enforced.
 */

export interface RawForbiddenPathRule {
  readonly id: string;
  readonly selector: string;
}

export interface RawPatternFlags {
  readonly flags?: readonly string[];
}

export interface RawForbiddenPatternRule extends RawPatternFlags {
  readonly id: string;
  readonly selector: string;
  readonly target: 'stringValues' | 'keys';
  readonly pattern: string;
}

export interface RawInvariantRule {
  readonly id: string;
  readonly assert: unknown;
}

export interface RawContractSchemaRef {
  readonly root: string;
  readonly resources?: readonly string[];
}

export interface RawForbiddenConfig {
  readonly paths?: readonly RawForbiddenPathRule[];
  readonly patterns?: readonly RawForbiddenPatternRule[];
}

export interface RawContractConfig {
  readonly id: string;
  readonly schema: RawContractSchemaRef;
  readonly invariants?: readonly RawInvariantRule[];
  readonly forbidden?: RawForbiddenConfig;
}

export interface RawRetryConfig {
  readonly maxAttempts: number;
  readonly delayMs?: number;
}

export interface RawArtifactSourceItem {
  readonly id: string;
  readonly path: string;
  readonly format: 'raw' | 'envelope';
}

export interface RawArtifactSourceConfig {
  readonly kind: 'artifacts';
  readonly items: readonly RawArtifactSourceItem[];
}

export interface RawCommandSourceConfig {
  readonly kind: 'command';
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly env?: readonly string[];
}

export type RawSourceConfig = RawArtifactSourceConfig | RawCommandSourceConfig;

export interface RawCheckConfig {
  readonly id: string;
  readonly contract: string;
  readonly source: RawSourceConfig;
  readonly retries?: RawRetryConfig;
}

export type ThresholdDirection = 'max-decrease' | 'max-increase' | 'min-value' | 'max-value';

export interface RawBaselineThreshold {
  readonly metric: string;
  readonly direction: ThresholdDirection;
  /** Exact decimal string (never a binary float) interpreted per `direction`. */
  readonly amount?: string;
  readonly minDenominator?: number;
}

export interface RawBaselineConfig {
  readonly report: string;
  readonly population: 'exact' | 'comparable';
  readonly thresholds: readonly RawBaselineThreshold[];
}

export interface RawReportsConfig {
  readonly json: string;
  readonly markdown: string;
}

export interface RawRedactionPatternRule extends RawPatternFlags {
  readonly id: string;
  readonly pattern: string;
}

export interface RawRedactionConfig {
  readonly paths?: readonly string[];
  readonly patterns?: readonly RawRedactionPatternRule[];
}

export interface AxiomConfigFileV1 {
  readonly version: 1;
  readonly contracts: readonly RawContractConfig[];
  readonly checks: readonly RawCheckConfig[];
  readonly baseline?: RawBaselineConfig;
  readonly reports: RawReportsConfig;
  readonly redaction?: RawRedactionConfig;
}
