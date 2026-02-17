import { createServer, type Server, type Socket } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { logger } from '../../lib/logging.js';
import type { StreamEndpoint } from '../../lib/runtime/daemon-protocol.js';

const SESSIONS_DIR = join(homedir(), '.agent-rig', 'run', 'sessions');

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export type SessionState = 'starting' | 'running' | 'exited' | 'error';

export interface PtySessionInfo {
  sessionId: string;
  sandboxName: string;
  command: string[];
  state: SessionState;
  pid?: number;
  exitCode?: number;
  createdAt: string;
  streamEndpoint: StreamEndpoint;
}

// ---------------------------------------------------------------------------
// PtySession — manages a single PTY session with a per-session Unix socket
// ---------------------------------------------------------------------------

export class PtySession {
  readonly sessionId: string;
  readonly sandboxName: string;
  readonly sandboxUser: string;
  readonly command: string[];
  readonly env: Record<string, string>;
  readonly token: string;

  private state: SessionState = 'starting';
  private process: ChildProcess | null = null;
  private server: Server | null = null;
  private socketPath: string;
  private exitCode: number | undefined;
  private createdAt: string;
  private clientSocket: Socket | null = null;
  private onExit: (() => void) | null = null;

  constructor(opts: {
    sessionId: string;
    sandboxName: string;
    sandboxUser: string;
    command: string[];
    env?: Record<string, string>;
    onExit?: () => void;
  }) {
    this.sessionId = opts.sessionId;
    this.sandboxName = opts.sandboxName;
    this.sandboxUser = opts.sandboxUser;
    this.command = opts.command;
    this.env = opts.env ?? {};
    this.token = randomBytes(16).toString('hex');
    this.socketPath = join(SESSIONS_DIR, `${this.sessionId}.sock`);
    this.createdAt = new Date().toISOString();
    this.onExit = opts.onExit ?? null;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<StreamEndpoint> {
    await mkdir(SESSIONS_DIR, { recursive: true });

    // Start the session socket server first
    await this.startSocketServer();

    // Spawn the command as the sandbox user
    this.spawnProcess();

    this.state = 'running';

    logger.info('pty session started', {
      component: 'pty-session',
      event: 'session_start',
      sandbox: this.sandboxName,
      sessionId: this.sessionId,
      pid: this.process?.pid,
    });

    return this.getStreamEndpoint();
  }

  async destroy(): Promise<void> {
    // Kill the process if still running
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      // Give it a moment, then force kill
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 2000);
    }

    // Close client connection
    if (this.clientSocket && !this.clientSocket.destroyed) {
      this.clientSocket.destroy();
      this.clientSocket = null;
    }

    // Close the socket server
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Clean up socket file
    await rm(this.socketPath, { force: true }).catch(() => {});

    logger.info('pty session destroyed', {
      component: 'pty-session',
      event: 'session_destroy',
      sandbox: this.sandboxName,
      sessionId: this.sessionId,
    });
  }

  // -------------------------------------------------------------------------
  // Info
  // -------------------------------------------------------------------------

  getInfo(): PtySessionInfo {
    return {
      sessionId: this.sessionId,
      sandboxName: this.sandboxName,
      command: this.command,
      state: this.state,
      pid: this.process?.pid,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
      streamEndpoint: this.getStreamEndpoint(),
    };
  }

  getStreamEndpoint(): StreamEndpoint {
    return {
      transport: 'unix-socket',
      path: this.socketPath,
      token: this.token,
    };
  }

  getState(): SessionState {
    return this.state;
  }

  getExitCode(): number | undefined {
    return this.exitCode;
  }

  // -------------------------------------------------------------------------
  // Socket server — per-session Unix socket for raw byte streaming
  // -------------------------------------------------------------------------

  private startSocketServer(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = createServer((socket) => {
        // Reject connections after first authenticated client
        if (this.clientSocket) {
          socket.destroy();
          return;
        }
        this.handleClient(socket);
      });

      this.server.on('error', (err) => {
        logger.error('session socket server error', {
          component: 'pty-session',
          event: 'socket_error',
          sessionId: this.sessionId,
          error: err,
        });
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        resolve();
      });
    });
  }

  private handleClient(socket: Socket): void {
    let authBuffer = '';

    const onAuthData = (chunk: Buffer) => {
      authBuffer += chunk.toString();
      const newlineIdx = authBuffer.indexOf('\n');
      if (newlineIdx === -1) return;

      const receivedToken = authBuffer.slice(0, newlineIdx).trim();
      const remainder = authBuffer.slice(newlineIdx + 1);

      // Remove auth listener — auth phase is over
      socket.removeListener('data', onAuthData);

      if (receivedToken !== this.token) {
        logger.warn('session auth failed', {
          component: 'pty-session',
          event: 'auth_failed',
          sessionId: this.sessionId,
        });
        socket.destroy();
        return;
      }

      this.clientSocket = socket;

      // Pipe process stdout/stderr to client
      if (this.process) {
        this.process.stdout?.pipe(socket, { end: false });
        this.process.stderr?.pipe(socket, { end: false });
      }

      // If there was data after the token line, forward it to stdin
      if (remainder.length > 0 && this.process?.stdin) {
        this.process.stdin.write(remainder);
      }

      // Install post-auth data listener: pipe client input to process stdin
      socket.on('data', (data: Buffer) => {
        if (this.process?.stdin && !this.process.stdin.destroyed) {
          this.process.stdin.write(data);
        }
      });
    };

    socket.on('data', onAuthData);

    socket.on('error', () => {
      // Client disconnected
    });

    socket.on('close', () => {
      if (this.clientSocket === socket) {
        this.clientSocket = null;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Process spawning
  // -------------------------------------------------------------------------

  private spawnProcess(): void {
    const args = ['-u', this.sandboxUser, '--', ...this.command];

    this.process = spawn('sudo', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env },
    });

    this.process.on('exit', (code, signal) => {
      this.exitCode = code ?? (signal ? 128 : 1);
      this.state = 'exited';

      logger.info('pty session process exited', {
        component: 'pty-session',
        event: 'process_exit',
        sessionId: this.sessionId,
        exitCode: this.exitCode,
        signal: signal ?? undefined,
      });

      // Notify client of exit by ending the connection
      if (this.clientSocket && !this.clientSocket.destroyed) {
        this.clientSocket.end();
      }

      this.onExit?.();
    });

    this.process.on('error', (err) => {
      this.state = 'error';
      logger.error('pty session process error', {
        component: 'pty-session',
        event: 'process_error',
        sessionId: this.sessionId,
        error: err,
      });

      this.onExit?.();
    });
  }
}
