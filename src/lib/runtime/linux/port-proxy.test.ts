import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startPortProxy, stopPortProxy, stopAllProxies } from './port-proxy.js';
import type { PortMapping } from '../../types.js';
import { getActiveProxies } from '../../ports.js';
import { createServer, createConnection } from 'node:net';

vi.mock('../../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Don't mock ports.js — we need the real getActiveProxies
// But we need to clear it between tests

describe('port-proxy', () => {
  beforeEach(() => {
    getActiveProxies().clear();
  });

  afterEach(async () => {
    // Clean up any running proxies
    await stopAllProxies();
  });

  const makeMapping = (overrides?: Partial<PortMapping>): PortMapping => ({
    id: 'pm_test123',
    hostPort: 0, // Use port 0 for auto-assign in tests
    targetPort: 9999,
    protocol: 'tcp',
    bindAddress: '127.0.0.1',
    status: 'active',
    createdAt: '2026-01-01',
    ...overrides,
  });

  describe('startPortProxy', () => {
    it('starts a proxy server and registers it', async () => {
      const mapping = makeMapping({ hostPort: 0 });
      // Port 0 will auto-assign, but our proxy uses the exact port
      // Use a high port that's likely free
      const testMapping = makeMapping({ hostPort: 49876, id: 'pm_start1' });

      await startPortProxy(testMapping, 10001, 'arig_sb_test');

      expect(getActiveProxies().has('pm_start1')).toBe(true);
    });

    it('does not start duplicate proxy', async () => {
      const mapping = makeMapping({ hostPort: 49877, id: 'pm_dup1' });
      await startPortProxy(mapping, 10001, 'arig_sb_test');
      // Second call should be a no-op
      await startPortProxy(mapping, 10001, 'arig_sb_test');
      expect(getActiveProxies().size).toBe(1);
    });

    it('rejects when port is in use', async () => {
      // Occupy a port first
      const blocker = createServer();
      await new Promise<void>((resolve) => {
        blocker.listen(49878, '127.0.0.1', resolve);
      });

      try {
        const mapping = makeMapping({ hostPort: 49878, id: 'pm_conflict' });
        await expect(
          startPortProxy(mapping, 10001, 'arig_sb_test'),
        ).rejects.toThrow('Failed to start proxy');
      } finally {
        blocker.close();
      }
    });
  });

  describe('stopPortProxy', () => {
    it('stops a running proxy', async () => {
      const mapping = makeMapping({ hostPort: 49879, id: 'pm_stop1' });
      await startPortProxy(mapping, 10001, 'arig_sb_test');
      expect(getActiveProxies().has('pm_stop1')).toBe(true);

      await stopPortProxy('pm_stop1');
      expect(getActiveProxies().has('pm_stop1')).toBe(false);
    });

    it('is a no-op for non-existent proxy', async () => {
      await stopPortProxy('pm_nonexistent');
      // Should not throw
    });
  });

  describe('stopAllProxies', () => {
    it('stops all running proxies', async () => {
      const m1 = makeMapping({ hostPort: 49880, id: 'pm_all1' });
      const m2 = makeMapping({ hostPort: 49881, id: 'pm_all2' });
      await startPortProxy(m1, 10001, 'arig_sb_test');
      await startPortProxy(m2, 10001, 'arig_sb_test');
      expect(getActiveProxies().size).toBe(2);

      await stopAllProxies();
      expect(getActiveProxies().size).toBe(0);
    });
  });
});
