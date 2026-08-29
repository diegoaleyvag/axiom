import type { JsonValue } from '../domain/json.js';
import { jsonTypeOf } from '../domain/json.js';
import type { Expr } from '../invariant/ast.js';
import { jsonDeepEqual } from './json-equal.js';
import { resolvePath, resolveSelector } from './path-resolve.js';
import { isMissing, MISSING, type EvalValue } from './values.js';

/**
 * Total, fail-closed interpreter for the closed declarative invariant/policy {@link Expr}
 * AST (see `../invariant/ast.ts`). "Total" means every well-typed `Expr` node evaluates to
 * some `EvalValue`/`boolean` for *any* bounded candidate document -- there is no throw path
 * here for a shape the AST itself cannot express, matching the plan's "missing values are a
 * sentinel, type mismatches fail closed" contract: a `path`/`select` through a missing key,
 * a scalar, or an out-of-range index resolves to {@link MISSING} rather than throwing, and
 * every boolean-producing operator treats a non-boolean or {@link MISSING} operand as
 * `false` rather than propagating a type error.
 *
 * `compileExpr` (`../invariant/compile.ts`) additionally requires every invariant rule's
 * top-level node to be one of the boolean-producing kinds, so {@link evaluateInvariant} can
 * assume its result is always a genuine boolean rather than a truthiness coercion of an
 * arbitrary value.
 */
export function evaluateInvariant(expr: Expr, document: JsonValue): boolean {
  return evaluateBoolean(expr, document);
}

function evaluate(expr: Expr, document: JsonValue): EvalValue {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'path':
      return resolvePath(document, expr.segments);
    case 'select':
      return [...resolveSelector(document, expr.segments)];
    case 'count':
      return countOf(evaluate(expr.of, document));
    case 'eq':
      return evaluateEq(expr.left, expr.right, document);
    case 'ne':
      return !evaluateEq(expr.left, expr.right, document);
    case 'lt':
      return compareNumeric(expr.left, expr.right, document, (a, b) => a < b);
    case 'lte':
      return compareNumeric(expr.left, expr.right, document, (a, b) => a <= b);
    case 'gt':
      return compareNumeric(expr.left, expr.right, document, (a, b) => a > b);
    case 'gte':
      return compareNumeric(expr.left, expr.right, document, (a, b) => a >= b);
    case 'subset':
      return evaluateSubset(expr.left, expr.right, document);
    case 'contains':
      return evaluateContains(expr.collection, expr.value, document);
    case 'exists':
      return !isMissing(evaluate(expr.target, document));
    case 'isType': {
      const value = evaluate(expr.target, document);
      return !isMissing(value) && jsonTypeOf(value) === expr.type;
    }
    case 'all':
      return expr.operands.every((operand) => evaluateBoolean(operand, document));
    case 'any':
      return expr.operands.some((operand) => evaluateBoolean(operand, document));
    case 'not':
      return !evaluateBoolean(expr.operand, document);
    case 'if':
      return evaluateBoolean(expr.condition, document)
        ? evaluateBoolean(expr.then, document)
        : evaluateBoolean(expr.else, document);
  }
}

/** Coerces any expression to boolean: only a genuine `boolean` `EvalValue` is ever `true`. */
function evaluateBoolean(expr: Expr, document: JsonValue): boolean {
  const value = evaluate(expr, document);
  return typeof value === 'boolean' ? value : false;
}

/** `MISSING` counts as zero; an array counts its elements; any other present value counts as one. */
function countOf(value: EvalValue): number {
  if (isMissing(value)) return 0;
  return Array.isArray(value) ? value.length : 1;
}

function evaluateEq(leftExpr: Expr, rightExpr: Expr, document: JsonValue): boolean {
  const left = evaluate(leftExpr, document);
  const right = evaluate(rightExpr, document);
  if (isMissing(left) || isMissing(right)) return false;
  return jsonDeepEqual(left, right);
}

function compareNumeric(
  leftExpr: Expr,
  rightExpr: Expr,
  document: JsonValue,
  compare: (a: number, b: number) => boolean,
): boolean {
  const left = evaluate(leftExpr, document);
  const right = evaluate(rightExpr, document);
  if (typeof left !== 'number' || typeof right !== 'number') return false;
  return compare(left, right);
}

function evaluateSubset(leftExpr: Expr, rightExpr: Expr, document: JsonValue): boolean {
  const left = evaluate(leftExpr, document);
  const right = evaluate(rightExpr, document);
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return left.every((item) => right.some((candidate) => jsonDeepEqual(item, candidate)));
}

function evaluateContains(collectionExpr: Expr, valueExpr: Expr, document: JsonValue): boolean {
  const collection = evaluate(collectionExpr, document);
  const value = evaluate(valueExpr, document);
  if (!Array.isArray(collection) || isMissing(value)) return false;
  return collection.some((item) => jsonDeepEqual(item, value));
}
