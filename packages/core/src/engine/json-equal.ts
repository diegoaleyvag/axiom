import type { JsonValue } from '../domain/json.js';
import { isJsonObject } from '../domain/json.js';

/** Structural equality over bounded JSON values: same shape and same values at every key/index. */
export function jsonDeepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, index) => jsonDeepEqual(item, b[index] as JsonValue));
  }
  if (isJsonObject(a) || isJsonObject(b)) {
    if (!isJsonObject(a) || !isJsonObject(b)) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) => Object.hasOwn(b, key) && jsonDeepEqual(a[key] as JsonValue, b[key] as JsonValue),
    );
  }
  return false;
}
