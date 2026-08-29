import type { JsonType, JsonValue } from '../domain/json.js';
import type { SelectorSegment } from './pointer.js';

/**
 * Closed declarative invariant/policy expression AST. This is the *only* way a config can
 * express a rule: there is no JavaScript, JSONPath filter expression, template string, or
 * `eval` escape hatch anywhere in this union, so every expression is statically
 * enumerable and cannot execute arbitrary code.
 *
 * Evaluating an `Expr` against candidate data (walking `path`/`select` against a real
 * document, applying the operators) is the evaluation engine's job and is implemented
 * later; this module only defines the closed shape and compiles/bounds-checks it (see
 * `./compile.js`).
 */
export type Expr =
  | { readonly kind: 'literal'; readonly value: JsonValue }
  | { readonly kind: 'path'; readonly segments: readonly string[] }
  | { readonly kind: 'select'; readonly segments: readonly SelectorSegment[] }
  | { readonly kind: 'count'; readonly of: Expr }
  | { readonly kind: 'eq'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'ne'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'lt'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'lte'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'gt'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'gte'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'subset'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'contains'; readonly collection: Expr; readonly value: Expr }
  | { readonly kind: 'exists'; readonly target: Expr }
  | { readonly kind: 'isType'; readonly target: Expr; readonly type: JsonType }
  | { readonly kind: 'all'; readonly operands: readonly Expr[] }
  | { readonly kind: 'any'; readonly operands: readonly Expr[] }
  | { readonly kind: 'not'; readonly operand: Expr }
  | { readonly kind: 'if'; readonly condition: Expr; readonly then: Expr; readonly else: Expr };

export type ExprKind = Expr['kind'];

export const EXPR_KINDS: readonly ExprKind[] = [
  'literal',
  'path',
  'select',
  'count',
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'subset',
  'contains',
  'exists',
  'isType',
  'all',
  'any',
  'not',
  'if',
];

/**
 * The subset of {@link ExprKind}s whose evaluated result (see `../engine/invariant-eval.js`)
 * is always a genuine `boolean`, as opposed to a `literal`/`path`/`select`/`count` node whose
 * value depends on the candidate document. An invariant rule's top-level `assert` must be one
 * of these kinds (enforced in `./compile.js`) so evaluating it can never silently coerce a
 * non-boolean value via truthiness.
 */
export const BOOLEAN_EXPR_KINDS: ReadonlySet<ExprKind> = new Set([
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'subset',
  'contains',
  'exists',
  'isType',
  'all',
  'any',
  'not',
  'if',
]);
