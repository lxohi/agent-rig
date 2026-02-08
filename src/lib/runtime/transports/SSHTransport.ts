import { Duplex } from 'node:stream';
import { execa, type ExecaChildProcess } from 'execa';
import type {
  DaemonTransport,
  StreamEndpoint,
  JsonRpcRequest,
  JsonRpcResponse,
} from './DaemonTransport.js';

// ---------------------------------------------------------------------------
// Future: VsockTransport placeholder
// When Lima/QEMU gains stable vsock support, a VsockTransport can replace
// SSHTransport for lower-latency, zero-config host↔VM communication.
// The DaemonTransport interface is transport-agnostic, so swapping in
// VsockTransport requires only changing the factory — no caller changes.
// ---------------------------------------------------------------------------

/**
 * SSH connection options for reaching arigd inside a shared VM.
 */
export interface SSHTransportOptions {
  /** SSH host (e.g. "127.0.0.1" for Lima port-forward). */
  host: string;
  /** SSH port. */
  port: number;
  /** SSH user inside the VM. */
  user: string;
  /** Path to the SSH private key. */
  identityFile: string;
  /** Path to the arigd Unix socket inside the VM. */
  remoteSocketPath: string;
  /** Disable strict host key checking (default: true for local VMs). */
  strictHostKeyChecking?: boolean;
}

/**
 * SSHTransport implements DaemonTransport by tunneling JSON-RPC requests
 * and stream connections over SSH to the arigd socket inside a shared VM.
 *
 * Each request() call opens a short-lived SSH connection that forwards
 * to the remote Unix socket, sends the JSON-RPC payload, and reads the
 * response. This mirrors LocalSocketTransport's connection-per-request
 * pattern but over SSH.
 *
 * openStream() uses SSH local port forwarding (-L) to tunnel a stream
 * endpoint (PTY session socket) back to the host.
 */
export class SSHTransport implements DaemonTransport {
  private opts: SSHTransportOptions;

  constructor(opts: SSHTransportOptions) {
    this.opts = opts;
  }

  /**
   * Build common SSH args used by both request() and openStream().
   */
  private baseSSHArgs(): string[] {
    const args = [
      '-o', `StrictHostKeyChecking=${this.opts.strictHostKeyChecking === false ? 'no' : 'yes'}`,
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-i', this.opts.identityFile,
      '-p', String(this.opts.port),
    ];
    return args;
  }

  async request(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const payload = JSON.stringify(req) + '\n';

    // Use socat inside the VM to connect to the arigd Unix socket.
    // SSH runs the remote command, we pipe JSON-RPC over stdin/stdout.
    // Shell-escape the path to prevent command injection.
    const escapedPath = this.opts.remoteSocketPath.replace(/'/g, "'\\''");
    const remoteCmd = `socat - UNIX-CONNECT:'${escapedPath}'`;

    const args = [
      ...this.baseSSHArgs(),
      `${this.opts.user}@${this.opts.host}`,
      remoteCmd,
    ];

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      let settled = false;

      const proc = execa('ssh', args, {
        input: payload,
        timeout: 10_000,
        reject: false,
      });

      proc.then((result) => {
        if (settled) return;
        settled = true;

        if (result.exitCode !== 0 && !result.stdout) {
          reject(new Error(
            `SSH command failed (exit ${result.exitCode}): ${result.stderr}`,
          ));
          return;
        }

        const stdout = result.stdout.trim();
        if (!stdout) {
          reject(new Error('Empty response from daemon via SSH'));
          return;
        }

        // Parse the first complete JSON line
        const newlineIdx = stdout.indexOf('\n');
        const line = newlineIdx !== -1 ? stdout.slice(0, newlineIdx) : stdout;

        try {
          resolve(JSON.parse(line) as JsonRpcResponse);
        } catch {
          reject(new Error('Invalid JSON response from daemon via SSH'));
        }
      }).catch((err: Error) => {
        if (settled) return;
        settled = true;
        reject(new Error(`SSH transport error: ${err.message}`));
      });
    });
  }

  async openStream(endpoint: StreamEndpoint): Promise<Duplex> {
    // SSHTransport can handle both 'ssh' and 'unix-socket' endpoints:
    // arigd returns 'unix-socket' endpoints (the socket is inside the VM),
    // and we use socat over SSH to reach it regardless of the declared type.
    if (endpoint.transport !== 'ssh' && endpoint.transport !== 'unix-socket') {
      throw new Error(
        `SSHTransport cannot handle transport: ${endpoint.transport}`,
      );
    }

    // Use socat inside the VM to connect to the session socket.
    // The SSH process stdin/stdout becomes the bidirectional stream.
    // Shell-escape the path to prevent command injection.
    const escapedPath = endpoint.path.replace(/'/g, "'\\''");
    const remoteCmd = `socat - UNIX-CONNECT:'${escapedPath}'`;

    const args = [
      ...this.baseSSHArgs(),
      '-T', // Disable pseudo-terminal allocation
      `${this.opts.user}@${this.opts.host}`,
      remoteCmd,
    ];

    return new Promise<Duplex>((resolve, reject) => {
      const proc = execa('ssh', args, {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        buffer: false,
      });

      const stdin = proc.stdin!;
      const stdout = proc.stdout!;

      // Create a Duplex that wraps the SSH process stdio
      const stream = new SSHStream(stdin, stdout, proc);

      // Send the session token for auth, then resolve
      stream.write(endpoint.token + '\n', (err) => {
        if (err) {
          reject(new Error(`Failed to send auth token: ${err.message}`));
          return;
        }
        resolve(stream);
      });

      proc.catch((err: Error) => {
        // Only reject if we haven't resolved yet
        stream.destroy(new Error(`SSH stream error: ${err.message}`));
      });
    });
  }

  async close(): Promise<void> {
    // SSHTransport is stateless per-request; nothing to close.
  }
}

/**
 * Duplex stream that wraps an SSH process's stdin/stdout.
 * Reading from this stream reads from the SSH stdout (remote -> local).
 * Writing to this stream writes to the SSH stdin (local -> remote).
 */
class SSHStream extends Duplex {
  private sshStdin: NodeJS.WritableStream;
  private sshStdout: NodeJS.ReadableStream;
  private proc: ExecaChildProcess;

  constructor(
    sshStdin: NodeJS.WritableStream,
    sshStdout: NodeJS.ReadableStream,
    proc: ExecaChildProcess,
  ) {
    super();
    this.sshStdin = sshStdin;
    this.sshStdout = sshStdout;
    this.proc = proc;

    // Forward data from SSH stdout to this Duplex's readable side
    this.sshStdout.on('data', (chunk: Buffer) => {
      if (!this.push(chunk)) {
        this.sshStdout.pause();
      }
    });

    this.sshStdout.on('end', () => {
      this.push(null);
    });

    this.sshStdout.on('error', (err: Error) => {
      this.destroy(err);
    });
  }

  _read(_size: number): void {
    this.sshStdout.resume();
  }

  _write(
    chunk: Buffer,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    const ok = this.sshStdin.write(chunk);
    if (ok) {
      callback();
    } else {
      (this.sshStdin as NodeJS.WritableStream).once('drain', () => callback());
    }
  }

  _destroy(err: Error | null, callback: (error?: Error | null) => void): void {
    this.sshStdin.end();
    this.proc.kill();
    callback(err);
  }
}
