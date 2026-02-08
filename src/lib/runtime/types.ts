export type SandboxState = 'running' | 'stopped' | 'creating' | 'broken' | 'unknown';

export interface RuntimeInfo {
  /** Driver-internal name (e.g. Lima VM name). Opaque to command layer. */
  name: string;
  /** Logical sandbox name that matches the config-layer name. */
  sandboxName: string;
  state: SandboxState;
  /** Runtime backend identifier, e.g. "lima", "linux-rootless", "macos-sharedvm" */
  driver: string;
  /** Opaque metadata from the underlying driver */
  meta?: Record<string, unknown>;
}

export interface SandboxRuntimeState {
  name: string;
  state: SandboxState;
  pid?: number;
  ports?: { host: number; container: number; proto: string }[];
  startedAt?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * RuntimeDriver is the abstraction boundary between CLI commands and the
 * underlying sandbox runtime (Lima, linux-rootless, macos-sharedvm, etc.).
 *
 * Each driver implements the full sandbox lifecycle plus exec/session helpers.
 */
export interface RuntimeDriver {
  /** Unique identifier for this driver, e.g. "lima" */
  readonly name: string;

  /** List all sandboxes visible to this driver. */
  list(): Promise<RuntimeInfo[]>;

  /** Return detailed info for a single sandbox. */
  inspect(sandboxName: string): Promise<RuntimeInfo | undefined>;

  /** Create a new sandbox (does not start it). */
  create(sandboxName: string, opts?: Record<string, unknown>): Promise<void>;

  /** Start an existing sandbox. */
  start(sandboxName: string): Promise<void>;

  /** Stop a running sandbox. */
  stop(sandboxName: string): Promise<void>;

  /** Destroy a sandbox and clean up resources. */
  destroy(sandboxName: string): Promise<void>;

  /** Execute a command inside a sandbox and return the result. */
  execRun(sandboxName: string, command: string[]): Promise<ExecResult>;

  /** Start an interactive exec session (PTY). Returns a cleanup handle. */
  startExecSession(sandboxName: string, command: string[]): Promise<void>;

  /** Attach to the primary session (e.g. tmux) of a sandbox. */
  startAttachSession(sandboxName: string): Promise<void>;
}
