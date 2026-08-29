import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoundsError, ConfigError } from '../errors.js';
import { createNodeFileSystem } from '../runtime/node-filesystem.js';
import { assertRealPathContained, resolveConfigRelativePath } from './paths.js';

describe('resolveConfigRelativePath', () => {
  const configDir = '/workspace/project';

  it('resolves a simple nested relative path under the config directory', () => {
    expect(resolveConfigRelativePath(configDir, 'contracts/a.schema.json', 'field')).toBe(
      path.resolve(configDir, 'contracts/a.schema.json'),
    );
  });

  it('rejects an empty path', () => {
    expect(() => resolveConfigRelativePath(configDir, '', 'field')).toThrow(ConfigError);
  });

  it('rejects a path over the maximum length', () => {
    expect(() => resolveConfigRelativePath(configDir, 'a'.repeat(5000), 'field')).toThrow(
      BoundsError,
    );
  });

  it('rejects a path containing a NUL byte', () => {
    expect(() => resolveConfigRelativePath(configDir, 'a\0b', 'field')).toThrow(ConfigError);
  });

  it('rejects backslashes', () => {
    expect(() => resolveConfigRelativePath(configDir, 'a\\b', 'field')).toThrow(ConfigError);
  });

  it('rejects absolute POSIX paths', () => {
    expect(() => resolveConfigRelativePath(configDir, '/etc/passwd', 'field')).toThrow(ConfigError);
  });

  it('rejects home-relative paths', () => {
    expect(() => resolveConfigRelativePath(configDir, '~/secrets', 'field')).toThrow(ConfigError);
  });

  it('rejects Windows drive-letter paths', () => {
    expect(() => resolveConfigRelativePath(configDir, 'C:/Windows', 'field')).toThrow(ConfigError);
  });

  it.each(['..', '../escape', 'a/../../escape', './a', 'a/./b', 'a//b', 'a/'])(
    'rejects "." / ".." / empty segments: %s',
    (rawPath) => {
      expect(() => resolveConfigRelativePath(configDir, rawPath, 'field')).toThrow(ConfigError);
    },
  );

  it('rejects a segment containing ":"', () => {
    expect(() => resolveConfigRelativePath(configDir, 'a/b:c', 'field')).toThrow(ConfigError);
  });
});

describe('assertRealPathContained', () => {
  const fs = createNodeFileSystem();
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'axiom-paths-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('accepts an existing file strictly inside the root', async () => {
    const target = path.join(root, 'inside.json');
    await writeFile(target, '{}');
    const real = await assertRealPathContained(fs, root, target, { mustExist: true });
    // Compare against the canonicalized path, not the raw target: on macOS, os.tmpdir()
    // itself sits under a symlink (/tmp -> /private/tmp, /var -> /private/var), so the
    // *correct* real path legitimately differs from the pre-resolution string.
    expect(real).toBe(await fs.realPath(target));
  });

  it('rejects a missing file when mustExist is true', async () => {
    const target = path.join(root, 'missing.json');
    await expect(assertRealPathContained(fs, root, target, { mustExist: true })).rejects.toThrow(
      ConfigError,
    );
  });

  it('accepts a write target that does not exist yet, as long as its ancestor is contained', async () => {
    const reportsDir = path.join(root, 'reports');
    const target = path.join(reportsDir, 'current.json');
    await mkdir(reportsDir);
    const real = await assertRealPathContained(fs, root, target, { mustExist: false });
    expect(real).toBe(path.join(await fs.realPath(reportsDir), 'current.json'));
  });

  it('rejects a symlink that escapes the root even though the syntactic path looked contained', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'axiom-paths-outside-'));
    try {
      const secret = path.join(outside, 'secret.json');
      await writeFile(secret, '{"leak": true}');

      const linkPath = path.join(root, 'escape.json');
      await symlink(secret, linkPath);

      await expect(
        assertRealPathContained(fs, root, linkPath, { mustExist: true }),
      ).rejects.toThrow(ConfigError);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked ancestor directory used to escape the root for a write target', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'axiom-paths-outside-'));
    try {
      const linkedDir = path.join(root, 'linked');
      await symlink(outside, linkedDir);

      const target = path.join(linkedDir, 'not-yet-created.json');
      await expect(assertRealPathContained(fs, root, target, { mustExist: false })).rejects.toThrow(
        ConfigError,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('does not treat a sibling directory with a matching name prefix as contained', async () => {
    // Regression guard for naive string-prefix containment checks: "/root-evil" starts
    // with the string "/root" but must not be treated as inside "/root".
    const evilSibling = `${root}-evil`;
    await mkdir(evilSibling, { recursive: true });
    try {
      const target = path.join(evilSibling, 'file.json');
      await writeFile(target, '{}');
      await expect(assertRealPathContained(fs, root, target, { mustExist: true })).rejects.toThrow(
        ConfigError,
      );
    } finally {
      await rm(evilSibling, { recursive: true, force: true });
    }
  });
});
