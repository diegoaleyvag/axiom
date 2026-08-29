/**
 * Effect ports injected into every config/engine module instead of importing Node's
 * `fs`/`child_process` directly. This is what makes "an invalid config performs no
 * referenced-file access, report write, or process spawn" a testable property: unit tests
 * pass a recording/failing fake port and assert it was never called (see
 * `packages/core/test/config/phase-order.test.ts`).
 */

export interface FileStats {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly size: number;
}

export interface ReadFileOptions {
  /** Reject (without buffering the whole file) if the file is larger than this. */
  readonly maxBytes: number;
}

export interface WriteFileOptions {
  /** When true (the default), fail instead of overwriting an existing file (`init`'s no-clobber contract). */
  readonly noClobber?: boolean;
}

export interface FileSystemPort {
  readFile(path: string, options: ReadFileOptions): Promise<string>;
  writeFile(path: string, contents: string, options?: WriteFileOptions): Promise<void>;
  /** Creates `path` and every missing ancestor directory; a no-op if it already exists. */
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<FileStats>;
  lstat(path: string): Promise<FileStats>;
  /** Resolves symlinks and `.`/`..` segments; throws if `path` does not exist. */
  realPath(path: string): Promise<string>;
}

export interface SpawnRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Already-filtered to the check's configured `env` allowlist -- never the full parent environment. */
  readonly env: Readonly<Record<string, string>>;
  /** Hard wall-clock timeout; exceeding it terminates the whole process tree. */
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

export interface SpawnResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

/**
 * Process execution port for the "explicitly consented command mode" source. The bounding
 * behavior (timeout, output caps, process-tree termination) is part of the port's own
 * contract -- identical for the real Node implementation (`./node-process.ts`) and any test
 * fake -- rather than left to each call site to reimplement.
 */
export interface ProcessPort {
  spawn(request: SpawnRequest): Promise<SpawnResult>;
}
