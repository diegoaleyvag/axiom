import type { JsonObject, JsonType, JsonValue } from '../domain/json.js';
import { isJsonObject } from '../domain/json.js';
import { BoundsError, ConfigError } from '../errors.js';
import type { Expr } from './ast.js';
import { parsePointer, parseSelector, type SelectorLimits } from './pointer.js';

export interface CompileExprLimits extends SelectorLimits {
  /** Maximum nesting depth of the expression tree itself (independent of pointer depth). */
  readonly maxDepth: number;
  /** Maximum total number of expression nodes in the whole tree. */
  readonly maxNodes: number;
  /** Maximum number of operands in a single `all`/`any` argument list. */
  readonly maxOperands: number;
}

const JSON_TYPES: ReadonlySet<JsonType> = new Set([
  'null',
  'boolean',
  'number',
  'string',
  'array',
  'object',
]);

interface CompileState {
  nodes: number;
}

/**
 * Compiles a JSON invariant/policy expression node (already schema-validated as *some*
 * object by `schemas/axiom-config.v1.schema.json`, which deliberately does not encode the
 * full recursive DSL grammar) into the closed {@link Expr} AST.
 *
 * This is where the "closed declarative invariant AST" guarantee actually lives: every
 * `kind` is explicitly enumerated, unknown kinds are rejected, and depth/node/operand
 * counts are bounded so a pathological config cannot produce an unbounded compile-time or
 * (later) evaluation-time cost. Throws {@link ConfigError} for shape/kind problems and
 * {@link BoundsError} once a limit is exceeded.
 */
export function compileExpr(node: JsonValue, limits: CompileExprLimits): Expr {
  const state: CompileState = { nodes: 0 };
  return compileNode(node, limits, 0, state);
}

function bumpNodeCount(state: CompileState, limits: CompileExprLimits): void {
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) {
    throw new BoundsError(
      'bounds.expr-too-many-nodes',
      `Invariant expression exceeds the maximum of ${limits.maxNodes} nodes.`,
    );
  }
}

function compileNode(
  node: JsonValue,
  limits: CompileExprLimits,
  depth: number,
  state: CompileState,
): Expr {
  bumpNodeCount(state, limits);
  if (depth > limits.maxDepth) {
    throw new BoundsError(
      'bounds.expr-too-deep',
      `Invariant expression exceeds the maximum depth of ${limits.maxDepth}.`,
    );
  }
  if (!isJsonObject(node)) {
    throw new ConfigError(
      'config.invalid-expression',
      'Invariant expression node must be an object with a "kind" field.',
    );
  }

  const kind = requireField(node, 'kind');
  if (typeof kind !== 'string') {
    throw new ConfigError(
      'config.invalid-expression',
      'Invariant expression node is missing a string "kind" field.',
    );
  }

  const next = (field: string): Expr =>
    compileNode(requireField(node, field), limits, depth + 1, state);

  switch (kind) {
    case 'literal':
      return { kind: 'literal', value: requireField(node, 'value') };
    case 'path':
      return { kind: 'path', segments: parsePointer(requireString(node, 'pointer'), limits) };
    case 'select':
      return { kind: 'select', segments: parseSelector(requireString(node, 'selector'), limits) };
    case 'count':
      return { kind: 'count', of: next('of') };
    case 'eq':
    case 'ne':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
    case 'subset':
      return { kind, left: next('left'), right: next('right') };
    case 'contains':
      return { kind: 'contains', collection: next('collection'), value: next('value') };
    case 'exists':
      return { kind: 'exists', target: next('target') };
    case 'isType': {
      const type = requireString(node, 'type');
      if (!JSON_TYPES.has(type as JsonType)) {
        throw new ConfigError(
          'config.invalid-expression',
          `Unknown JSON type "${type}" in an "isType" expression.`,
        );
      }
      return { kind: 'isType', target: next('target'), type: type as JsonType };
    }
    case 'all':
    case 'any':
      return {
        kind,
        operands: requireArray(node, 'operands', limits.maxOperands).map((operand) =>
          compileNode(operand, limits, depth + 1, state),
        ),
      };
    case 'not':
      return { kind: 'not', operand: next('operand') };
    case 'if':
      return { kind: 'if', condition: next('condition'), then: next('then'), else: next('else') };
    default:
      throw new ConfigError(
        'config.invalid-expression',
        `Unknown invariant expression kind "${kind}".`,
      );
  }
}

function requireField(node: JsonObject, field: string): JsonValue {
  if (!Object.hasOwn(node, field)) {
    throw new ConfigError(
      'config.invalid-expression',
      `Invariant expression is missing the required field "${field}".`,
    );
  }
  return node[field] as JsonValue;
}

function requireString(node: JsonObject, field: string): string {
  const value = requireField(node, field);
  if (typeof value !== 'string') {
    throw new ConfigError(
      'config.invalid-expression',
      `Invariant expression field "${field}" must be a string.`,
    );
  }
  return value;
}

function requireArray(node: JsonObject, field: string, maxLength: number): JsonValue[] {
  const value = requireField(node, field);
  if (!Array.isArray(value)) {
    throw new ConfigError(
      'config.invalid-expression',
      `Invariant expression field "${field}" must be an array.`,
    );
  }
  if (value.length > maxLength) {
    throw new BoundsError(
      'bounds.expr-too-many-operands',
      `Invariant expression field "${field}" exceeds the maximum of ${maxLength} operands.`,
    );
  }
  return value;
}
