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
    id: 'pm_edge_test',
    hostPort: 0,
    targetPort: 8080,
    protocol: 'tcp' as const,
    bindAddress: '127.0.0.1',
    status: 'active' as const,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('macOS relay edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveRelays().clear();
  });

  afterEach(async () => {
    await stopAllRelays();
  });

  describe('getActiveRelays()', () => {
    it('returns the internal Map instance', () => {
      const relays = getActiveRelays();
      expect(relays).toBeInstanceOf(Map);
      expect(relays.size).toBe(0);
    });

    it('reflects changes after startRelay', async () => {
      const mapping = makeMapping();
      await startRelay(mapping, defaultSSHOpts);

      const relays = getActiveRelays();
      expect(relays.size).toBe(1);
      const relay = relays.get('pm_edge_test')!;
      expect(relay.connections).toBeInstanceOf(Set);
      expect(relay.tunnels).toBeInstanceOf(Set);
      expect(relay.connections.size).toBe(0);
      expect(relay.tunnels.size).toBe(0);
    });
  });

  describe('startRelay()', () => {
    it('relay server listens on assigned port', async () => {
      const mapping = makeMapping();
      await startRelay(mapping, defaultSSHOpts);

      const relay = getActiveRelays().get('pm_edge_test')!;
      const addr = relay.server.address();
      expect(addr).toBeTruthy();
      expect(typeof addr === 'object' && addr !== null ? addr.port : 0).toBeGreaterThan(0);
    });

    it('handles multiple relays with different IDs', async () => {
      const m1 = makeMapping({ id: 'pm_edge_1' });
      const m2 = makeMapping({ id: 'pm_edge_2' });
      const m3 = makeMapping({ id: 'pm_edge_3' });

      await startRelay(m1, defaultSSHOpts);
      await startRelay(m2, defaultSSHOpts);
      await startRelay(m3, defaultSSHOpts);

      expect(getActiveRelays().size).toBe(3);
    });
  });

  describe('stopRelay()', () => {
    it('server is no longer listening after stop', async () => {
      const mapping = makeMapping();
      await startRelay(mapping, defaultSSHOpts);

      const relay = getActiveRelays().get('pm_edge_test')!;
      expect(relay.server.listening).toBe(true);

      await stopRelay('pm_edge_test');
      expect(relay.server.listening).toBe(false);
    });
  });

  describe('stopAllRelays()', () => {
    it('is a no-op when no relays are active', async () => {
      expect(getActiveRelays().size).toBe(0);
      await expect(stopAllRelays()).resolves.toBeUndefined();
    });
  });
});
