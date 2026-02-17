import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startPortProxy, stopPortProxy, stopAllProxies } from './port-proxy.js';
import type { PortMapping } from '../../types.js';
import { getActiveProxies } from '../../ports.js';
import { createServer, createConnection, type Server } from 'node:net';

vi.mock('../../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('port-proxy edge cases', () => {
  beforeEach(() => {
    getActiveProxies().clear();
  });

  afterEach(async () => {
    await stopAllProxies();
  });

  const makeMapping = (overrides?: Partial<PortMapping>): PortMapping => ({
    id: 'pm_edge_test',
    hostPort: 0,
    targetPort: 9999,
    protocol: 'tcp',
    bindAddress: '127.0.0.1',
    status: 'active',
    createdAt: '2026-01-01',
    ...overrides,
  });

  it('duplicate startPortProxy is idempotent', async () => {
    const mapping = makeMapping({ hostPort: 49900, id: 'pm_idem' });
    await startPortProxy(mapping, 10001, 'arig_sb_test');
    await startPortProxy(mapping, 10001, 'arig_sb_test');
    expect(getActiveProxies().size).toBe(1);
  });

  it('stopPortProxy for non-existent ID is a no-op', async () => {
    await stopPortProxy('pm_does_not_exist');
    // Should not throw
  });

  it('stopAllProxies clears all entries', async () => {
    const m1 = makeMapping({ hostPort: 49901, id: 'pm_sa1' });
    const m2 = makeMapping({ hostPort: 49902, id: 'pm_sa2' });
    const m3 = makeMapping({ hostPort: 49903, id: 'pm_sa3' });
    await startPortProxy(m1, 10001, 'arig_sb_test');
    await startPortProxy(m2, 10001, 'arig_sb_test');
    await startPortProxy(m3, 10001, 'arig_sb_test');
    expect(getActiveProxies().size).toBe(3);

    await stopAllProxies();
    expect(getActiveProxies().size).toBe(0);
  });

  it('rejects when port is occupied by another process', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => {
      blocker.listen(49904, '127.0.0.1', resolve);
    });

    try {
      const mapping = makeMapping({ hostPort: 49904, id: 'pm_blocked' });
      await expect(
        startPortProxy(mapping, 10001, 'arig_sb_test'),
      ).rejects.toThrow('Failed to start proxy');
      expect(getActiveProxies().has('pm_blocked')).toBe(false);
    } finally {
      blocker.close();
    }
  });

  it('proxy server accepts connections after start', async () => {
    const mapping = makeMapping({ hostPort: 49905, id: 'pm_conn' });
    await startPortProxy(mapping, 10001, 'arig_sb_test');

    // Verify the proxy is listening by connecting to it
    const connected = await new Promise<boolean>((resolve) => {
      const client = createConnection({ port: 49905, host: '127.0.0.1' });
      client.on('connect', () => {
        client.destroy();
        resolve(true);
      });
      client.on('error', () => resolve(false));
    });

    expect(connected).toBe(true);
  });

  it('stop destroys active connections', async () => {
    const mapping = makeMapping({ hostPort: 49906, id: 'pm_destroy_conn' });
    await startPortProxy(mapping, 10001, 'arig_sb_test');

    // Connect a client
    const client = createConnection({ port: 49906, host: '127.0.0.1' });
    await new Promise<void>((resolve) => {
      client.on('connect', resolve);
    });

    // Stop the proxy — should destroy the connection
    await stopPortProxy('pm_destroy_conn');

    // Client should be disconnected
    const destroyed = await new Promise<boolean>((resolve) => {
      if (client.destroyed) {
        resolve(true);
      } else {
        client.on('close', () => resolve(true));
        setTimeout(() => resolve(false), 1000);
      }
    });

    expect(destroyed).toBe(true);
  });
});
