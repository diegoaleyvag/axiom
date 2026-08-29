import path from 'node:path';
import { BoundsError, ConfigError, InternalError } from '../errors.js';
import { isEnoentError } from '../runtime/node-filesystem.js';
import type { FileSystemPort } from '../runtime/ports.js';

const MAX_PATH_LENGTH = 4096;

/**
 * Pure, I/O-free syntactic resolution of a configured path against the directory
 * containing `axiom.config.yaml`. Every configured path (schema root, schema resources,
 * artifact/baseline paths, report outputs) must go through this before it is ever passed
 * to a filesystem port, and this alone must run during config compilation -- no I/O.
 *
 * Rejects, with a {@link ConfigError} (or {@link BoundsError} for the length cap):
 *
 * - empty strings, or strings longer than {@link MAX_PATH_LENGTH}
 * - embedded NUL bytes
 * - backslashes (paths must be written with `/`, so the same config is unambiguous on
 *   every OS and cannot smuggle a Windows drive/UNC path through a POSIX-looking string)
 * - absolute paths, drive-letter paths (`C:...`), and UNC paths (`//server/share`,
 *   `\\server\share`)
 * - `.` and `..` segments -- disallowed outright (not merely "when they would escape")
 *   so containment never depends on subtle lexical-normalization reasoning
 * - any result that, after normalization, is not strictly inside `configDir`
 *
 * This function does not check whether the path exists or follow symlinks; see
 * {@link assertRealPathContained} for the I/O-touching containment check performed at the
 * point of actual read/write (deliberately not exercised by config compilation itself,
 * since compiling a config must not access any referenced file).
 */
export function resolveConfigRelativePath(
  configDir: string,
  rawPath: string,
  fieldLabel: string,
): string {
  if (rawPath.length === 0) {
    throw new ConfigError('config.path-empty', `${fieldLabel} must not be empty.`);
  }
  if (rawPath.length > MAX_PATH_LENGTH) {
    throw new BoundsError(
      'bounds.path-too-long',
      `${fieldLabel} exceeds the maximum length of ${MAX_PATH_LENGTH} characters.`,
    );
  }
  if (rawPath.includes('\0')) {
    throw new ConfigError('config.path-invalid', `${fieldLabel} contains a NUL byte.`);
  }
  if (rawPath.includes('\\')) {
    throw new ConfigError(
      'config.path-invalid',
      `${fieldLabel} must use "/" separators, not "\\".`,
    );
  }
  if (rawPath.startsWith('/') || rawPath.startsWith('~')) {
    throw new ConfigError(
      'config.path-escapes-root',
      `${fieldLabel} must be relative to the config file, not absolute or home-relative.`,
    );
  }
  if (/^[A-Za-z]:/.test(rawPath)) {
    throw new ConfigError(
      'config.path-escapes-root',
      `${fieldLabel} must not be a drive-letter path.`,
    );
  }

  const segments = rawPath.split('/');
  for (const segment of segments) {
    if (segment === '') {
      throw new ConfigError(
        'config.path-invalid',
        `${fieldLabel} must not contain empty segments ("//" or a trailing "/").`,
      );
    }
    if (segment === '.' || segment === '..') {
      throw new ConfigError(
        'config.path-invalid',
        `${fieldLabel} must not contain "." or ".." segments.`,
      );
    }
    if (segment.includes(':')) {
      throw new ConfigError(
        'config.path-invalid',
        `${fieldLabel} segment "${segment}" must not contain ":".`,
      );
    }
  }

  const resolved = path.resolve(configDir, ...segments);
  const relativeFromRoot = path.relative(configDir, resolved);
  if (
    relativeFromRoot === '' ||
    relativeFromRoot.startsWith('..') ||
    path.isAbsolute(relativeFromRoot)
  ) {
    throw new ConfigError(
      'config.path-escapes-root',
      `${fieldLabel} resolves outside the config root.`,
    );
  }

  return resolved;
}

interface AncestorResolution {
  readonly realAncestor: string;
  readonly missingSuffixSegments: readonly string[];
}

async function realPathOfNearestExistingAncestor(
  fs: FileSystemPort,
  target: string,
): Promise<AncestorResolution> {
  const missing: string[] = [];
  let current = target;
  for (;;) {
    try {
      const real = await fs.realPath(current);
      return { realAncestor: real, missingSuffixSegments: missing };
    } catch (error) {
      if (!(error instanceof InternalError && isEnoentError(error.cause))) {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new InternalError(
          'internal.fs-no-existing-ancestor',
          `No existing ancestor directory was found while resolving "${target}".`,
        );
      }
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

function assertWithinRoot(realRoot: string, realTarget: string, describedPath: string): void {
  const relative = path.relative(realRoot, realTarget);
  if (relative === '') return;
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ConfigError(
      'config.path-escapes-root',
      `"${describedPath}" resolves outside the allowed root once symlinks are resolved.`,
    );
  }
}

export interface RealPathContainmentOptions {
  /** When true, `absolutePath` must already exist (used for read targets). */
  readonly mustExist: boolean;
}

/**
 * I/O-touching containment check performed at the point an already syntactically-resolved
 * path is actually read or written. Resolves symlinks with the injected {@link
 * FileSystemPort} (never native `fs`) and re-verifies containment *after* resolution, so a
 * symlink cannot be used to escape `root` even though the pre-symlink path looked safe.
 *
 * For write targets that do not exist yet (`mustExist: false`), this walks up to the
 * nearest existing ancestor directory, resolves *that* real path, and re-appends the
 * not-yet-created suffix -- so a symlinked ancestor directory cannot be used to escape the
 * root merely because the leaf file has not been created.
 */
export async function assertRealPathContained(
  fs: FileSystemPort,
  root: string,
  absolutePath: string,
  options: RealPathContainmentOptions,
): Promise<string> {
  const realRoot = await fs.realPath(root);
  const { realAncestor, missingSuffixSegments } = await realPathOfNearestExistingAncestor(
    fs,
    absolutePath,
  );

  if (options.mustExist && missingSuffixSegments.length > 0) {
    throw new ConfigError('config.path-not-found', `"${absolutePath}" does not exist.`);
  }

  const realTarget =
    missingSuffixSegments.length > 0
      ? path.join(realAncestor, ...missingSuffixSegments)
      : realAncestor;

  assertWithinRoot(realRoot, realTarget, absolutePath);
  return realTarget;
}
