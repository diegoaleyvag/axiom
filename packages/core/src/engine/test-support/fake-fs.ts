import { BoundsError, ConfigError, InternalError } from '../../errors.js';
import type { FileStats, FileSystemPort } from '../../runtime/ports.js';

function enoent(path: string): NodeJS.ErrnoException {
  const error = new Error(`ENOENT (fake fs): ${path}`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

/**
 * A minimal in-memory {@link FileSystemPort} for engine unit tests that need real read/write
 * behavior (byte limits, no-clobber writes) without touching the real filesystem.
 */
export function createInMemoryFileSystem(
  initialFiles: Readonly<Record<string, string>> = {},
): FileSystemPort {
  const store = new Map<string, string>(Object.entries(initialFiles));

  return {
    async readFile(path, { maxBytes }) {
      const content = store.get(path);
      if (content === undefined) {
        throw new InternalError(
          'internal.fs-read-failed',
          `Failed to read "${path}".`,
          enoent(path),
        );
      }
      if (Buffer.byteLength(content, 'utf8') > maxBytes) {
        throw new BoundsError(
          'bounds.max-bytes-exceeded',
          `"${path}" exceeds the ${maxBytes} byte limit.`,
        );
      }
      return content;
    },

    async writeFile(path, contents, options) {
      const noClobber = options?.noClobber ?? true;
      if (noClobber && store.has(path)) {
        throw new ConfigError('config.target-exists', `"${path}" already exists.`);
      }
      store.set(path, contents);
    },

    async mkdir() {
      // No directory semantics in this flat in-memory store; writes always "succeed".
    },

    async stat(path): Promise<FileStats> {
      if (!store.has(path)) {
        throw new InternalError(
          'internal.fs-stat-failed',
          `Failed to stat "${path}".`,
          enoent(path),
        );
      }
      return {
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        size: store.get(path)?.length ?? 0,
      };
    },

    async lstat(path): Promise<FileStats> {
      if (!store.has(path)) {
        throw new InternalError(
          'internal.fs-lstat-failed',
          `Failed to lstat "${path}".`,
          enoent(path),
        );
      }
      return {
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        size: store.get(path)?.length ?? 0,
      };
    },

    async realPath(path) {
      if (!store.has(path)) {
        throw new InternalError(
          'internal.fs-realpath-failed',
          `Failed to resolve "${path}".`,
          enoent(path),
        );
      }
      return path;
    },
  };
}
