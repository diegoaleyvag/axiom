import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../domain/json.js';
import type { SelectorSegment } from '../invariant/pointer.js';
import { resolvePath, resolveSelector } from './path-resolve.js';
import { MISSING } from './values.js';

const exact = (key: string): SelectorSegment => ({ kind: 'exact', key });
const wildcard: SelectorSegment = { kind: 'wildcard' };

describe('resolvePath', () => {
  const document: JsonValue = { items: [{ id: 'a' }, { id: 'b' }], count: 2 };

  it('resolves an existing nested path', () => {
    expect(resolvePath(document, ['items', '0', 'id'])).toBe('a');
  });

  it('resolves the whole document for an empty segment list', () => {
    expect(resolvePath(document, [])).toEqual(document);
  });

  it('is MISSING for a missing object key', () => {
    expect(resolvePath(document, ['nope'])).toBe(MISSING);
  });

  it('is MISSING for an out-of-range array index', () => {
    expect(resolvePath(document, ['items', '5'])).toBe(MISSING);
  });

  it('is MISSING when indexing into a scalar (type mismatch fails closed)', () => {
    expect(resolvePath(document, ['count', 'x'])).toBe(MISSING);
  });

  it('is MISSING once a prior segment was already MISSING', () => {
    expect(resolvePath(document, ['nope', 'deeper', 'more'])).toBe(MISSING);
  });

  it('rejects a non-canonical array index segment', () => {
    expect(resolvePath(document, ['items', '01'])).toBe(MISSING);
  });
});

describe('resolveSelector', () => {
  const document: JsonValue = {
    items: [
      { id: 'a', tags: ['x', 'y'] },
      { id: 'b', tags: ['z'] },
    ],
  };

  it('expands a single wildcard over an array', () => {
    expect(resolveSelector(document, [exact('items'), wildcard, exact('id')])).toEqual(['a', 'b']);
  });

  it('expands nested wildcards, flattening every match', () => {
    expect(resolveSelector(document, [exact('items'), wildcard, exact('tags'), wildcard])).toEqual([
      'x',
      'y',
      'z',
    ]);
  });

  it('is an empty array (not MISSING) when a wildcard matches nothing', () => {
    expect(resolveSelector(document, [exact('nope'), wildcard])).toEqual([]);
  });

  it('is an empty array when a wildcard is applied through a scalar', () => {
    expect(resolveSelector({ id: 'scalar' }, [exact('id'), wildcard])).toEqual([]);
  });

  it('resolves the whole document for an empty selector', () => {
    expect(resolveSelector(document, [])).toEqual([document]);
  });
});
