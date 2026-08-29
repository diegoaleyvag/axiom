import { mkdir, open, lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Stats } from 'node:fs';
import { BoundsError, ConfigError, InternalError } from '../errors.js';
import type { FileStats, FileSystemPort } from './ports.js';

/** True when `cause` is a Node `EEXIST` (path already exists) error. */
function isEexistError(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { code?: unknown }).code === 'EEXIST'
  );
}

function toFileStats(nodeStats: Stats): FileStats {
  return {
    isFile: nodeStats.isFile(),
    isDirectory: nodeStats.isDirectory(),
    isSymbolicLink: nodeStats.isSymbolicLink(),
    size: nodeStats.size,
  };
}

/** True when `cause` is a Node `ENOENT` (path does not exist) error. */
export function isEnoentError(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { code?: unknown }).code === 'ENOENT'
  );
}

/**
 * Real Node.js-backed {@link FileSystemPort}. Reads never buffer more than the caller's
 * declared `maxBytes`: the file is `stat`-ed (via the already-open handle, avoiding a
 * TOCTOU gap between checking size and reading) before its contents are loaded.
 *
 * Every failure is wrapped in {@link InternalError} with the original Node error preserved
 * as `cause` (never rendered directly -- see the redaction pipeline). Callers that can
 * give a failure semantic meaning (e.g. "the config referenced a schema that does not
 * exist") should inspect `cause` with helpers like {@link isEnoentError} and re-wrap into a
 * more specific {@link ConfigError}/{@link InputEnvelopeError}; this port intentionally
 * does not guess that context itself.
 */
export function createNodeFileSystem(): FileSystemPort {
  return {
    async readFile(path, { maxBytes }) {
      let handle;
      try {
        handle = await open(path, 'r');
      } catch (error) {
        throw new InternalError('internal.fs-open-failed', `Failed to open "${path}".`, error);
      }
      try {
        const stats = await handle.stat();
        if (stats.size > maxBytes) {
          throw new BoundsError(
            'bounds.max-bytes-exceeded',
            `"${path}" is ${stats.size} bytes, exceeding the ${maxBytes} byte limit.`,
          );
        }
        const buffer = await handle.readFile();
        return buffer.toString('utf8');
      } catch (error) {
        if (error instanceof BoundsError) {
          throw error;
        }
        throw new InternalError('internal.fs-read-failed', `Failed to read "${path}".`, error);
      } finally {
        await handle.close();
      }
    },

    async writeFile(filePath, contents, options) {
      const noClobber = options?.noClobber ?? true;
      await mkdir(path.dirname(filePath), { recursive: true }).catch((error: unknown) => {
        throw new InternalError(
          'internal.fs-mkdir-failed',
          `Failed to create the parent directory of "${filePath}".`,
          error,
        );
      });
      let handle;
      try {
        handle = await open(filePath, noClobber ? 'wx' : 'w');
      } catch (error) {
        if (noClobber && isEexistError(error)) {
          throw new ConfigError('config.target-exists', `"${filePath}" already exists.`, error);
        }
        throw new InternalError(
          'internal.fs-open-failed',
          `Failed to open "${filePath}" for writing.`,
          error,
        );
      }
      try {
        await handle.writeFile(contents, 'utf8');
      } catch (error) {
        throw new InternalError(
          'internal.fs-write-failed',
          `Failed to write "${filePath}".`,
          error,
        );
      } finally {
        await handle.close();
      }
    },

    async mkdir(dirPath) {
      try {
        await mkdir(dirPath, { recursive: true });
      } catch (error) {
        throw new InternalError(
          'internal.fs-mkdir-failed',
          `Failed to create directory "${dirPath}".`,
          error,
        );
      }
    },

    async stat(path) {
      try {
        return toFileStats(await stat(path));
      } catch (error) {
        throw new InternalError('internal.fs-stat-failed', `Failed to stat "${path}".`, error);
      }
    },

    async lstat(path) {
      try {
        return toFileStats(await lstat(path));
      } catch (error) {
        throw new InternalError('internal.fs-lstat-failed', `Failed to lstat "${path}".`, error);
      }
    },

    async realPath(path) {
      try {
        return await realpath(path);
      } catch (error) {
        throw new InternalError(
          'internal.fs-realpath-failed',
          `Failed to resolve the real path of "${path}".`,
          error,
        );
      }
    },
  };
}
