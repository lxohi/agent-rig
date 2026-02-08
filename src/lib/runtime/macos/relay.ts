import { createServer, type Server, type Socket } from 'node:net';
import { execa, type ExecaChildProcess } from 'execa';
import { logger } from '../../logging.js';
import type { PortMapping } from '../../types.js';

/**
 * Active dual-hop relay instance.
 */
export interface ActiveRelay {
  server: Server;
  portMapping: PortMapping;
  connections: Set<Socket>;
  tunnels: Set<ExecaChildProcess>;
}

/** In-memory registry of active relays keyed by port mapping id. */
const activeRelays = new Map<string, ActiveRelay>();

/** Get the active relays map. */
export function getActiveRelays(): Map<string, ActiveRelay> {
  return activeRelays;
}

/**
 * SSH options needed to reach the shared VM.
 */
export interface RelaySSHOptions {
  host: string;
  port: number;
  user: string;
  identityFile: string;
}

/**
 * Start a dual-hop port relay for a macOS port mapping.
 *
 * Traffic flow:
 *   macHost:hostPort -> SSH tunnel -> sharedVM:targetPort -> sandbox:targetPort
 *
 * For each incoming connection on hostPort, we spawn an SSH process that
 * connects to the target port inside the shared VM (where the sandbox's
 * dockerd has bound it). The SSH stdin/stdout becomes the bidirectional
 * data channel.
 *
 * This avoids needing a persistent SSH tunnel with -L, instead creating
 * per-connection tunnels via socat on the remote side.
 */
export async function startRelay(
  mapping: PortMapping,
  sshOpts: RelaySSHOptions,
): Promise<void> {
  if (activeRelays.has(mapping.id)) {
    logger.warn(`Relay already running for ${mapping.id}`, {
      component: 'macos-relay',
      event: 'relay.already_running',
    });
    return;
  }

  const logFields = {
    component: 'macos-relay',
    event: 'relay.start',
    portMappingId: mapping.id,
    hostPort: mapping.hostPort,
    targetPort: mapping.targetPort,
    bindAddress: mapping.bindAddress,
  };

  const connections = new Set<Socket>();
  const tunnels = new Set<ExecaChildProcess>();

  const server = createServer((clientSocket) => {
    connections.add(clientSocket);

    // Spawn an SSH process that connects to the target port inside the VM
    const remoteCmd = `socat - TCP4:127.0.0.1:${mapping.targetPort}`;
    const proc = execa('ssh', [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-i', sshOpts.identityFile,
      '-p', String(sshOpts.port),
      '-T',
      `${sshOpts.user}@${sshOpts.host}`,
      remoteCmd,
    ], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      buffer: false,
    });

    tunnels.add(proc);

    const sshStdin = proc.stdin!;
    const sshStdout = proc.stdout!;

    // Bidirectional pipe: client <-> SSH process
    clientSocket.pipe(sshStdin);
    sshStdout.pipe(clientSocket);

    const cleanup = () => {
      connections.delete(clientSocket);
      tunnels.delete(proc);
      clientSocket.destroy();
      proc.kill();
    };

    clientSocket.on('error', cleanup);
    clientSocket.on('close', cleanup);
    proc.catch(() => {
      // SSH process exited — clean up the client connection
      cleanup();
    });
  });

  server.on('error', (err) => {
    logger.error(`Relay server error for ${mapping.id}: ${err.message}`, {
      ...logFields,
      event: 'relay.error',
      error: err.message,
    });
  });

  return new Promise<void>((resolve, reject) => {
    server.listen(mapping.hostPort, mapping.bindAddress, () => {
      activeRelays.set(mapping.id, { server, portMapping: mapping, connections, tunnels });
      logger.info(
        `Relay started: ${mapping.bindAddress}:${mapping.hostPort} -> VM:${mapping.targetPort}`,
        logFields,
      );
      resolve();
    });

    server.once('error', (err) => {
      reject(new Error(
        `Failed to start relay on ${mapping.bindAddress}:${mapping.hostPort}: ${err.message}`,
      ));
    });
  });
}

/**
 * Stop a dual-hop relay by mapping ID.
 */
export async function stopRelay(mappingId: string): Promise<void> {
  const relay = activeRelays.get(mappingId);
  if (!relay) return;

  // Kill all SSH tunnel processes
  for (const proc of relay.tunnels) {
    proc.kill();
  }
  relay.tunnels.clear();

  // Close all active connections
  for (const conn of relay.connections) {
    conn.destroy();
  }
  relay.connections.clear();

  // Close the server
  return new Promise<void>((resolve) => {
    relay.server.close(() => {
      activeRelays.delete(mappingId);
      logger.info(`Relay stopped: ${mappingId}`, {
        component: 'macos-relay',
        event: 'relay.stop',
        portMappingId: mappingId,
      });
      resolve();
    });
  });
}

/**
 * Stop all active relays.
 */
export async function stopAllRelays(): Promise<void> {
  const ids = [...activeRelays.keys()];
  for (const id of ids) {
    await stopRelay(id);
  }
}
