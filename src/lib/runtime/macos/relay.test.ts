import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('../../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execa } from 'execa';
import {
  startRelay,
  stopRelay,
  stopAllRelays,
  getActiveRelays,
} from './relay.js';

const mockExeca = vi.mocked(execa);

const defaultSSHOpts = {
  host: '127.0.0.1',
  port: 60022,
  user: 'default',
  identityFile: '/home/user/.lima/_config/user',
};

function makeMapping(overrides?: Record<string, unknown>) {
  return {
    id: 'pm_test123',
    hostPort: 0, // Use port 0 to get a random available port
    targetPort: 8080,
    protocol: 'tcp' as const,
    bindAddress: '127.0.0.1',
    status: 'active' as const,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('macOS relay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear active relays between tests
    const relays = getActiveRelays();
    relays.clear();
  });

  afterEach(async () => {
    // Clean up any active relays
    await stopAllRelays();
  });

  describe('startRelay()', () => {
    it('starts a relay server on the specified port', async () => {
      const mapping = makeMapping();

      await startRelay(mapping, defaultSSHOpts);

      const relays = getActiveRelays();
      expect(relays.has('pm_test123')).toBe(true);

      const relay = relays.get('pm_test123')!;
      expect(relay.portMapping).toBe(mapping);
      expect(relay.server.listening).toBe(true);
    });

    it('skips if relay already running for mapping', async () => {
      const mapping = makeMapping();

      await startRelay(mapping, defaultSSHOpts);
      // Second call should be a no-op
      await startRelay(mapping, defaultSSHOpts);

      const relays = getActiveRelays();
      expect(relays.size).toBe(1);
    });

    it('rejects when port is already in use', async () => {
      // Start a server on a specific port first
      const { createServer } = await import('node:net');
      const blocker = createServer();

      const port = await new Promise<number>((resolve) => {
        blocker.listen(0, '127.0.0.1', () => {
          const addr = blocker.address();
          resolve(typeof addr === 'object' ? addr!.port : 0);
        });
      });

      try {
        const mapping = makeMapping({ hostPort: port });
        await expect(startRelay(mapping, defaultSSHOpts)).rejects.toThrow(
          'Failed to start relay',
        );
      } finally {
        blocker.close();
      }
    });
  });

  describe('stopRelay()', () => {
    it('stops a running relay and removes from registry', async () => {
      const mapping = makeMapping();
      await startRelay(mapping, defaultSSHOpts);

      expect(getActiveRelays().has('pm_test123')).toBe(true);

      await stopRelay('pm_test123');

      expect(getActiveRelays().has('pm_test123')).toBe(false);
    });

    it('is a no-op for unknown mapping ID', async () => {
      await expect(stopRelay('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('stopAllRelays()', () => {
    it('stops all active relays', async () => {
      const m1 = makeMapping({ id: 'pm_one' });
      const m2 = makeMapping({ id: 'pm_two' });

      await startRelay(m1, defaultSSHOpts);
      await startRelay(m2, defaultSSHOpts);

      expect(getActiveRelays().size).toBe(2);

      await stopAllRelays();

      expect(getActiveRelays().size).toBe(0);
    });
  });
});
