import { createServer, type Server, type Socket } from 'node:net';
import { execa } from 'execa';
import { logger } from '../../logging.js';
import type { PortMapping } from '../../types.js';
import { getActiveProxies } from '../../ports.js';

/**
 * Start a userspace TCP proxy for a port mapping.
 * Listens on hostPort and forwards to the sandbox user's targetPort
 * via the sandbox user's docker socket network.
 *
 * No iptables/CAP_NET_ADMIN required — pure userspace TCP relay.
 */
export async function startPortProxy(
  mapping: PortMapping,
  sandboxUid: number,
  sandboxUsername: string,
): Promise<void> {
  const proxies = getActiveProxies();

  if (proxies.has(mapping.id)) {
    logger.warn(`Proxy already running for ${mapping.id}`, {
      component: 'port-proxy',
      event: 'proxy.already_running',
    });
    return;
  }

  const logFields = {
    component: 'port-proxy',
    event: 'proxy.start',
    portMappingId: mapping.id,
    hostPort: mapping.hostPort,
    targetPort: mapping.targetPort,
    bindAddress: mapping.bindAddress,
  };

  const connections = new Set<Socket>();

  const server = createServer((clientSocket) => {
    connections.add(clientSocket);
    let cleaned = false;

    // Connect to the target port inside the sandbox user's network namespace.
    // Rootless docker binds container ports to the sandbox user's loopback,
    // NOT the host loopback. We use nsenter to enter the user's namespace
    // and socat to bridge stdin/stdout to the target TCP port.
    const proc = execa('nsenter', [
      '-t', String(sandboxUid),
      '--user', '--net',
      '--', 'socat', '-', `TCP4:127.0.0.1:${mapping.targetPort}`,
    ], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      buffer: false,
    });

    const sshStdin = proc.stdin!;
    const sshStdout = proc.stdout!;

    // Bidirectional pipe: client <-> nsenter/socat process
    clientSocket.pipe(sshStdin);
    sshStdout.pipe(clientSocket);

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      connections.delete(clientSocket);
      clientSocket.destroy();
      proc.kill();
    };

    clientSocket.on('error', cleanup);
    clientSocket.on('close', cleanup);
    proc.catch(() => cleanup());
  });

  server.on('error', (err) => {
    logger.error(`Proxy server error for ${mapping.id}: ${err.message}`, {
      ...logFields,
      event: 'proxy.error',
      error: err.message,
    });
  });

  return new Promise<void>((resolve, reject) => {
    server.listen(mapping.hostPort, mapping.bindAddress, () => {
      proxies.set(mapping.id, { server, portMapping: mapping, connections });
      logger.info(
        `Proxy started: ${mapping.bindAddress}:${mapping.hostPort} -> ${mapping.targetPort}`,
        logFields,
      );
      resolve();
    });

    server.once('error', (err) => {
      reject(new Error(`Failed to start proxy on ${mapping.bindAddress}:${mapping.hostPort}: ${err.message}`));
    });
  });
}

/**
 * Stop a port proxy by mapping ID.
 */
export async function stopPortProxy(mappingId: string): Promise<void> {
  const proxies = getActiveProxies();
  const proxy = proxies.get(mappingId);
  if (!proxy) return;

  // Close all active connections
  for (const conn of proxy.connections) {
    conn.destroy();
  }
  proxy.connections.clear();

  // Close the server
  return new Promise<void>((resolve) => {
    proxy.server.close(() => {
      proxies.delete(mappingId);
      logger.info(`Proxy stopped: ${mappingId}`, {
        component: 'port-proxy',
        event: 'proxy.stop',
        portMappingId: mappingId,
      });
      resolve();
    });
  });
}

/**
 * Stop all active port proxies.
 */
export async function stopAllProxies(): Promise<void> {
  const proxies = getActiveProxies();
  const ids = [...proxies.keys()];
  for (const id of ids) {
    await stopPortProxy(id);
  }
}
