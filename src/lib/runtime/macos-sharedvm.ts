import type { RuntimeDriver, RuntimeInfo, ExecResult } from './types.js';
import { SSHTransport, type SSHTransportOptions } from './transports/SSHTransport.js';
import { DaemonClient } from './daemon-client.js';
import { logger } from '../logging.js';
import {
  SHARED_VM_NAME,
  getVMStatus,
  startVM,
} from './macos/vm-manager.js';
import { execa } from 'execa';

/** Default arigd socket path inside the shared VM. */
const VM_ARIGD_SOCKET = '/run/arig/arigd.sock';

/** Default SSH user inside the shared VM (Lima default). */
const VM_SSH_USER = 'default';

/**
 * Resolve SSH connection details for the shared VM from Lima.
 *
 * Lima exposes SSH config via `limactl show-ssh --format config`.
 * We parse the HostName, Port, and IdentityFile from the output.
 */
async function resolveSSHConfig(): Promise<SSHTransportOptions> {
  const { stdout } = await execa('limactl', [
    'show-ssh', '--format', 'config', SHARED_VM_NAME,
  ]);

  let host = '127.0.0.1';
  let port = 0;
  let user = VM_SSH_USER;
  let identityFile = '';

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('HostName ')) {
      host = trimmed.slice('HostName '.length);
    } else if (trimmed.startsWith('Port ')) {
      port = parseInt(trimmed.slice('Port '.length), 10);
    } else if (trimmed.startsWith('User ')) {
      user = trimmed.slice('User '.length);
    } else if (trimmed.startsWith('IdentityFile ')) {
      identityFile = trimmed.slice('IdentityFile '.length).replace(/^"(.*)"$/, '$1');
    }
  }

  if (port === 0 || !identityFile) {
    throw new Error(
      `Failed to resolve SSH config for shared VM "${SHARED_VM_NAME}". ` +
      'Ensure the VM is running with "arig runtime init" or "arig runtime repair".',
    );
  }

  return {
    host,
    port,
    user,
    identityFile,
    remoteSocketPath: VM_ARIGD_SOCKET,
    strictHostKeyChecking: false,
  };
}

/**
 * macOS shared VM RuntimeDriver.
 *
 * On macOS, all sandboxes run inside a single shared Lima VM.
 * The host CLI communicates with arigd inside the VM over SSH.
 * Port mapping uses a dual-hop relay: host -> VM -> sandbox.
 */
export class MacOSSharedVMDriver implements RuntimeDriver {
  readonly name = 'macos-sharedvm';

  private sshConfig: SSHTransportOptions | undefined;

  /**
   * Lazily resolve and cache SSH config for the shared VM.
   */
  private async getSSHConfig(): Promise<SSHTransportOptions> {
    if (!this.sshConfig) {
      this.sshConfig = await resolveSSHConfig();
    }
    return this.sshConfig;
  }

  /**
   * Create a DaemonClient connected to arigd inside the shared VM.
   */
  private async createClient(): Promise<DaemonClient> {
    const sshConfig = await this.getSSHConfig();
    const transport = new SSHTransport(sshConfig);
    return new DaemonClient({ transport });
  }

  /**
   * Ensure the shared VM is running. Auto-starts if stopped.
   */
  private async ensureVMRunning(): Promise<void> {
    const vmInfo = await getVMStatus();

    if (vmInfo.status === 'running') return;

    if (vmInfo.status === 'stopped') {
      logger.info('Auto-starting shared VM', {
        component: 'macos-sharedvm',
        event: 'vm.auto_start',
      });
      await startVM();
      // Invalidate cached SSH config since port may change
      this.sshConfig = undefined;
      return;
    }

    if (vmInfo.status === 'not_found') {
      throw new Error(
        'Shared VM not found. Run "arig runtime init" to set up the macOS runtime.',
      );
    }

    throw new Error(
      `Shared VM is in "${vmInfo.status}" state. Run "arig runtime repair" to fix.`,
    );
  }

  async list(): Promise<RuntimeInfo[]> {
    await this.ensureVMRunning();
    const client = await this.createClient();

    try {
      // Use runtime.ping to verify connectivity, then list sandboxes
      // by inspecting arigd's sandbox state
      const result = await client.call('runtime.ping', {});
      if (!result.pong) {
        throw new Error('arigd ping failed');
      }

      // arigd doesn't have a sandbox.list method yet — list sandbox
      // users by querying /etc/passwd inside the VM for arig_sb_ prefix
      const { stdout } = await execa('limactl', [
        'shell', SHARED_VM_NAME, '--',
        'getent', 'passwd',
      ], { reject: false });

      const infos: RuntimeInfo[] = [];
      for (const line of (stdout || '').split('\n')) {
        if (!line) continue;
        const parts = line.split(':');
        const username = parts[0];
        if (!username.startsWith('arig_sb_')) continue;

        const sandboxName = username.slice('arig_sb_'.length).replace(/_/g, '-');
        infos.push({
          name: username,
          sandboxName,
          state: 'unknown', // Would need inspect() per sandbox for accurate state
          driver: this.name,
          meta: { username },
        });
      }

      return infos;
    } finally {
      await client.close();
    }
  }

  async inspect(sandboxName: string): Promise<RuntimeInfo | undefined> {
    await this.ensureVMRunning();
    const client = await this.createClient();

    try {
      const result = await client.call('sandbox.inspect', { sandboxName });
      return {
        name: `arig_sb_${sandboxName.replace(/-/g, '_')}`,
        sandboxName,
        state: result.state,
        driver: this.name,
        meta: {
          pid: result.pid,
          ports: result.ports,
          startedAt: result.startedAt,
        },
      };
    } catch (error) {
      const err = error as { code?: number };
      // Sandbox not found is not an error — return undefined
      if (err.code === 1001) return undefined;
      throw error;
    } finally {
      await client.close();
    }
  }

  async create(sandboxName: string, opts?: Record<string, unknown>): Promise<void> {
    await this.ensureVMRunning();
    const client = await this.createClient();

    const logFields = {
      component: 'macos-sharedvm',
      event: 'sandbox.create',
      sandbox: sandboxName,
    };

    logger.info(`Creating sandbox ${sandboxName}`, logFields);

    try {
      await client.call('sandbox.create', {
        sandboxName,
        config: opts,
      });
      logger.info(`Sandbox ${sandboxName} created`, logFields);
    } finally {
      await client.close();
    }
  }

  async start(sandboxName: string): Promise<void> {
    await this.ensureVMRunning();
    const client = await this.createClient();

    const logFields = {
      component: 'macos-sharedvm',
      event: 'sandbox.start',
      sandbox: sandboxName,
    };

    logger.info(`Starting sandbox ${sandboxName}`, logFields);

    try {
      await client.call('sandbox.start', { sandboxName });
      logger.info(`Sandbox ${sandboxName} started`, logFields);
    } finally {
      await client.close();
    }
  }

  async stop(sandboxName: string): Promise<void> {
    await this.ensureVMRunning();
    const client = await this.createClient();

    const logFields = {
      component: 'macos-sharedvm',
      event: 'sandbox.stop',
      sandbox: sandboxName,
    };

    logger.info(`Stopping sandbox ${sandboxName}`, logFields);

    try {
      await client.call('sandbox.stop', { sandboxName });
      logger.info(`Sandbox ${sandboxName} stopped`, logFields);
    } finally {
      await client.close();
    }
  }

  async destroy(sandboxName: string): Promise<void> {
    await this.ensureVMRunning();
    const client = await this.createClient();

    const logFields = {
      component: 'macos-sharedvm',
      event: 'sandbox.destroy',
      sandbox: sandboxName,
    };

    logger.info(`Destroying sandbox ${sandboxName}`, logFields);

    try {
      // Stop relays for this sandbox before destroying
      const { stopAllRelays } = await import('./macos/relay.js');
      await stopAllRelays();

      await client.call('sandbox.destroy', { sandboxName });
      logger.info(`Sandbox ${sandboxName} destroyed`, logFields);
    } finally {
      await client.close();
    }
  }

  async execRun(sandboxName: string, command: string[]): Promise<ExecResult> {
    await this.ensureVMRunning();
    const client = await this.createClient();

    try {
      const result = await client.call('sandbox.exec.run', {
        sandboxName,
        command,
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    } finally {
      await client.close();
    }
  }

  async startExecSession(sandboxName: string, command: string[]): Promise<void> {
    await this.ensureVMRunning();
    const client = await this.createClient();

    try {
      // 1. Request a session from arigd
      const session = await client.call('sandbox.exec.startSession', {
        sandboxName,
        command,
      });

      // 2. Open a stream to the session endpoint via SSH
      const sshConfig = await this.getSSHConfig();
      const transport = new SSHTransport(sshConfig);
      const stream = await transport.openStream(session.streamEndpoint);

      // 3. Pipe stdin/stdout/stderr for interactive use
      process.stdin.setRawMode?.(true);
      process.stdin.pipe(stream);
      stream.pipe(process.stdout);

      // 4. Wait for stream to end
      await new Promise<void>((resolve) => {
        stream.on('end', resolve);
        stream.on('close', resolve);
        stream.on('error', resolve);
      });

      process.stdin.setRawMode?.(false);
      process.stdin.unpipe(stream);
    } finally {
      await client.close();
    }
  }

  async startAttachSession(sandboxName: string): Promise<void> {
    await this.ensureVMRunning();
    const client = await this.createClient();

    try {
      // 1. Request an attach session from arigd
      const session = await client.call('sandbox.attach.startSession', {
        sandboxName,
      });

      // 2. Open a stream to the session endpoint via SSH
      const sshConfig = await this.getSSHConfig();
      const transport = new SSHTransport(sshConfig);
      const stream = await transport.openStream(session.streamEndpoint);

      // 3. Pipe stdin/stdout for interactive use
      process.stdin.setRawMode?.(true);
      process.stdin.pipe(stream);
      stream.pipe(process.stdout);

      // 4. Wait for stream to end
      await new Promise<void>((resolve) => {
        stream.on('end', resolve);
        stream.on('close', resolve);
        stream.on('error', resolve);
      });

      process.stdin.setRawMode?.(false);
      process.stdin.unpipe(stream);
    } finally {
      await client.close();
    }
  }
}
