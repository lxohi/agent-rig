import { createServer, type Server, type Socket } from 'node:net';
import { logger } from './logging.js';
import type { PortMapping } from './types.js';
import { loadSandboxConfig, saveSandboxConfig } from './sandbox.js';
import { randomUUID } from 'node:crypto';

/** Active proxy instance tracking. */
interface ActiveProxy {
  server: Server;
  portMapping: PortMapping;
  connections: Set<Socket>;
}

/** In-memory registry of active port proxies keyed by port mapping id. */
const activeProxies = new Map<string, ActiveProxy>();

/** Validate port number range. */
export function validatePort(port: number, label: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${label}: ${port} (must be 1-65535)`);
  }
}

/** Check if a host port is already in use. */
export async function isPortAvailable(
  hostPort: number,
  bindAddress: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once('error', () => resolve(false));
    tester.listen(hostPort, bindAddress, () => {
      tester.close(() => resolve(true));
    });
  });
}

/**
 * Generate a unique port mapping ID.
 */
export function generatePortMappingId(): string {
  return `pm_${randomUUID().slice(0, 12)}`;
}

/**
 * Add a port mapping to a sandbox.
 * If sandbox is running, immediately starts the proxy.
 * If stopped, writes as pending for next start.
 */
export async function addPortMapping(
  sandboxName: string,
  hostPort: number,
  targetPort: number,
  opts?: {
    protocol?: 'tcp';
    bindAddress?: string;
    sandboxRunning?: boolean;
    sandboxUid?: number;
    sandboxUsername?: string;
  },
): Promise<PortMapping> {
  const protocol = opts?.protocol ?? 'tcp';
  const bindAddress = opts?.bindAddress ?? '127.0.0.1';

  validatePort(hostPort, 'host port');
  validatePort(targetPort, 'target port');

  // Check for conflicts
  const available = await isPortAvailable(hostPort, bindAddress);
  if (!available) {
    throw new Error(
      `Port ${bindAddress}:${hostPort} is already in use`,
    );
  }

  // Check for duplicate in config
  const config = await loadSandboxConfig(sandboxName);
  const existing = (config.ports ?? []).find(
    (p) => p.hostPort === hostPort && p.protocol === protocol,
  );
  if (existing) {
    throw new Error(
      `Port mapping for ${protocol}/${hostPort} already exists (id: ${existing.id})`,
    );
  }

  const mapping: PortMapping = {
    id: generatePortMappingId(),
    hostPort,
    targetPort,
    protocol,
    bindAddress,
    status: opts?.sandboxRunning ? 'active' : 'pending',
    createdAt: new Date().toISOString(),
  };

  // Save to config
  config.ports = [...(config.ports ?? []), mapping];
  await saveSandboxConfig(config);

  // If running, start proxy immediately
  if (opts?.sandboxRunning && opts.sandboxUid !== undefined) {
    const { startPortProxy } = await import('./runtime/linux/port-proxy.js');
    await startPortProxy(mapping, opts.sandboxUid, opts.sandboxUsername!);
  }

  logger.info(`Port mapping added: ${bindAddress}:${hostPort} -> ${targetPort}`, {
    component: 'ports',
    event: 'port.add',
    sandbox: sandboxName,
  });

  return mapping;
}

/**
 * Remove a port mapping from a sandbox.
 * If running, immediately tears down the proxy.
 */
export async function removePortMapping(
  sandboxName: string,
  hostPort: number,
  opts?: { sandboxRunning?: boolean },
): Promise<void> {
  const config = await loadSandboxConfig(sandboxName);
  const idx = (config.ports ?? []).findIndex((p) => p.hostPort === hostPort);
  if (idx === -1) {
    throw new Error(`No port mapping found for host port ${hostPort}`);
  }

  const mapping = config.ports![idx];

  // If running, stop the proxy
  if (opts?.sandboxRunning && activeProxies.has(mapping.id)) {
    const { stopPortProxy } = await import('./runtime/linux/port-proxy.js');
    await stopPortProxy(mapping.id);
  }

  // Remove from config
  config.ports!.splice(idx, 1);
  await saveSandboxConfig(config);

  logger.info(`Port mapping removed: ${mapping.bindAddress}:${hostPort}`, {
    component: 'ports',
    event: 'port.remove',
    sandbox: sandboxName,
  });
}

/**
 * List port mappings for a sandbox.
 */
export async function listPortMappings(
  sandboxName: string,
): Promise<PortMapping[]> {
  const config = await loadSandboxConfig(sandboxName);
  return config.ports ?? [];
}

/**
 * Apply all pending port mappings for a sandbox that is starting.
 * Transitions pending -> active and starts proxies.
 */
export async function applyPendingPorts(
  sandboxName: string,
  sandboxUid: number,
  sandboxUsername: string,
): Promise<void> {
  const config = await loadSandboxConfig(sandboxName);
  const pending = (config.ports ?? []).filter((p) => p.status === 'pending');

  if (pending.length === 0) return;

  const { startPortProxy } = await import('./runtime/linux/port-proxy.js');

  for (const mapping of pending) {
    try {
      const available = await isPortAvailable(mapping.hostPort, mapping.bindAddress);
      if (!available) {
        mapping.status = 'error';
        mapping.lastError = `Port ${mapping.bindAddress}:${mapping.hostPort} is in use`;
        continue;
      }
      await startPortProxy(mapping, sandboxUid, sandboxUsername);
      mapping.status = 'active';
      mapping.lastError = undefined;
    } catch (error) {
      mapping.status = 'error';
      mapping.lastError = (error as Error).message;
    }
  }

  await saveSandboxConfig(config);
}

/**
 * Stop all active port proxies for a sandbox.
 * Used during sandbox stop.
 */
export async function stopAllPorts(sandboxName: string): Promise<void> {
  const config = await loadSandboxConfig(sandboxName);
  const { stopPortProxy } = await import('./runtime/linux/port-proxy.js');

  for (const mapping of config.ports ?? []) {
    if (mapping.status === 'active' && activeProxies.has(mapping.id)) {
      await stopPortProxy(mapping.id);
      mapping.status = 'pending';
    }
  }

  await saveSandboxConfig(config);
}

/** Get the active proxies map (for use by port-proxy module). */
export function getActiveProxies(): Map<string, ActiveProxy> {
  return activeProxies;
}
