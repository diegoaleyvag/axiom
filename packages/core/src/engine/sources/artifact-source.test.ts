import { describe, expect, it } from 'vitest';
import type { CompiledArtifactSource } from '../../domain/compiled-config.js';
import { InputEnvelopeError } from '../../errors.js';
import { createInMemoryFileSystem } from '../test-support/fake-fs.js';
import { loadArtifactCases } from './artifact-source.js';

describe('loadArtifactCases', () => {
  it('treats a "raw" item as one case with exactly one attempt: the literal file bytes', async () => {
    const fs = createInMemoryFileSystem({ '/cases/a.txt': 'not even json' });
    const source: CompiledArtifactSource = {
      kind: 'artifacts',
      items: [{ id: 'case-a', path: '/cases/a.txt', format: 'raw' }],
    };
    const cases = await loadArtifactCases(fs, source);
    expect(cases).toEqual([{ caseId: 'case-a', attempts: ['not even json'] }]);
  });

  it('decodes and validates an "envelope" item, extracting ordered attempt contents', async () => {
    const envelope = JSON.stringify({
      artifactVersion: 1,
      caseId: 'case-b',
      attempts: [{ content: '{"bad":' }, { content: '{"ok":true}' }],
    });
    const fs = createInMemoryFileSystem({ '/cases/b.json': envelope });
    const source: CompiledArtifactSource = {
      kind: 'artifacts',
      items: [{ id: 'case-b', path: '/cases/b.json', format: 'envelope' }],
    };
    const cases = await loadArtifactCases(fs, source);
    expect(cases).toEqual([{ caseId: 'case-b', attempts: ['{"bad":', '{"ok":true}'] }]);
  });

  it('throws InputEnvelopeError (exit 2) for a malformed envelope -- never a json-category finding', async () => {
    const fs = createInMemoryFileSystem({ '/cases/c.json': '{not valid json' });
    const source: CompiledArtifactSource = {
      kind: 'artifacts',
      items: [{ id: 'case-c', path: '/cases/c.json', format: 'envelope' }],
    };
    await expect(loadArtifactCases(fs, source)).rejects.toThrow(InputEnvelopeError);
  });

  it('throws InputEnvelopeError when the envelope caseId does not match the configured item id', async () => {
    const envelope = JSON.stringify({
      artifactVersion: 1,
      caseId: 'wrong-id',
      attempts: [{ content: '{}' }],
    });
    const fs = createInMemoryFileSystem({ '/cases/d.json': envelope });
    const source: CompiledArtifactSource = {
      kind: 'artifacts',
      items: [{ id: 'case-d', path: '/cases/d.json', format: 'envelope' }],
    };
    await expect(loadArtifactCases(fs, source)).rejects.toThrow(InputEnvelopeError);
  });
});
