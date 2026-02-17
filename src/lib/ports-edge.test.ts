import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validatePort,
  isPortAvailable,
  generatePortMappingId,
  addPortMapping,
  removePortMapping,
  listPortMappings,
  applyPendingPorts,
  stopAllPorts,
  getActiveProxies,
} from './ports.js';

vi.mock('./logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./sandbox.js', () => ({
  loadSandboxConfig: vi.fn(),
  saveSandboxConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./runtime/linux/port-proxy.js', () => ({
  startPortProxy: vi.fn().mockResolvedValue(undefined),
  stopPortProxy: vi.fn().mockResolvedValue(undefined),
}));

import { loadSandboxConfig, saveSandboxConfig } from './sandbox.js';
import { startPortProxy, stopPortProxy } from './runtime/linux/port-proxy.js';

const freshConfig = () => ({
  name: 'test',
  repo: '',
  branch: '',
  packages: [],
  vm: { cpus: 1, memory: '1G', disk: '10G' },
  created: '2026-01-01',
  ports: [] as any[],
});

describe('ports edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveProxies().clear();
    vi.mocked(loadSandboxConfig).mockImplementation(async () => freshConfig());
  });

  describe('validatePort edge cases', () => {
    it('rejects port 0', () => {
      expect(() => validatePort(0, 'host port')).toThrow('Invalid host port: 0');
    });

    it('rejects NaN', () => {
      expect(() => validatePort(NaN, 'test')).toThrow('Invalid test');
    });

    it('rejects Infinity', () => {
      expect(() => validatePort(Infinity, 'test')).toThrow('Invalid test');
    });

    it('rejects negative port', () => {
      expect(() => validatePort(-100, 'test')).toThrow('Invalid test');
    });

    it('accepts boundary ports 1 and 65535', () => {
      expect(() => validatePort(1, 'test')).not.toThrow();
      expect(() => validatePort(65535, 'test')).not.toThrow();
    });
  });

  describe('generatePortMappingId', () => {
    it('generates IDs with pm_ prefix and 12-char suffix', () => {
      const id = generatePortMappingId();
      expect(id).toMatch(/^pm_[a-f0-9-]{12}$/);
    });

    it('generates unique IDs across 50 calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        ids.add(generatePortMappingId());
      }
      expect(ids.size).toBe(50);
    });
  });

  describe('addPortMapping edge cases', () => {
    it('rejects host port 0 (no auto-allocation)', async () => {
      await expect(addPortMapping('test', 0, 8080)).rejects.toThrow(
        'Invalid host port: 0'
      );
    });

    it('rejects target port 0', async () => {
      await expect(addPortMapping('test', 8080, 0)).rejects.toThrow(
        'Invalid target port: 0'
      );
    });

    it('rejects duplicate host port in config', async () => {
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        ...freshConfig(),
        ports: [{
          id: 'pm_existing', hostPort: 18080, targetPort: 8080,
          protocol: 'tcp', bindAddress: '127.0.0.1',
          status: 'active', createdAt: '2026-01-01',
        }],
      });
      await expect(addPortMapping('test', 18080, 9090)).rejects.toThrow(
        'already exists'
      );
    });

    it('sets status to pending when sandbox is not running', async () => {
      const mapping = await addPortMapping('test', 18082, 8080);
      expect(mapping.status).toBe('pending');
      expect(startPortProxy).not.toHaveBeenCalled();
    });

    it('sets status to active and starts proxy when sandbox is running', async () => {
      const mapping = await addPortMapping('test', 18083, 8080, {
        sandboxRunning: true,
        sandboxUid: 10001,
        sandboxUsername: 'arig_sb_test',
      });
      expect(mapping.status).toBe('active');
      expect(startPortProxy).toHaveBeenCalledWith(
        expect.objectContaining({ hostPort: 18083 }),
        10001,
        'arig_sb_test',
      );
    });

    it('defaults bindAddress to 127.0.0.1', async () => {
      const mapping = await addPortMapping('test', 18084, 8080);
      expect(mapping.bindAddress).toBe('127.0.0.1');
    });

    it('uses custom bindAddress 0.0.0.0', async () => {
      const mapping = await addPortMapping('test', 18085, 8080, {
        bindAddress: '0.0.0.0',
      });
      expect(mapping.bindAddress).toBe('0.0.0.0');
    });

    it('saves config after adding mapping', async () => {
      await addPortMapping('test', 18086, 8080);
      expect(saveSandboxConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          ports: expect.arrayContaining([
            expect.objectContaining({ hostPort: 18086 }),
          ]),
        }),
      );
    });
  });

  describe('removePortMapping edge cases', () => {
    it('throws when removing non-existent port', async () => {
      await expect(removePortMapping('test', 99999)).rejects.toThrow(
        'No port mapping found for host port 99999'
      );
    });

    it('removes mapping from config and saves', async () => {
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        ...freshConfig(),
        ports: [
          {
            id: 'pm_1', hostPort: 18080, targetPort: 8080,
            protocol: 'tcp', bindAddress: '127.0.0.1',
            status: 'pending', createdAt: '2026-01-01',
          },
          {
            id: 'pm_2', hostPort: 18081, targetPort: 8081,
            protocol: 'tcp', bindAddress: '127.0.0.1',
            status: 'pending', createdAt: '2026-01-01',
          },
        ],
      });

      await removePortMapping('test', 18080);

      // Should save config with only the second mapping
      const savedConfig = vi.mocked(saveSandboxConfig).mock.calls[0][0] as any;
      expect(savedConfig.ports).toHaveLength(1);
      expect(savedConfig.ports[0].hostPort).toBe(18081);
    });

    it('stops proxy when sandbox is running and proxy is active', async () => {
      // Put a fake proxy in the active map
      getActiveProxies().set('pm_active', {
        server: {} as any,
        portMapping: {} as any,
        connections: new Set(),
      });

      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        ...freshConfig(),
        ports: [{
          id: 'pm_active', hostPort: 18080, targetPort: 8080,
          protocol: 'tcp', bindAddress: '127.0.0.1',
          status: 'active', createdAt: '2026-01-01',
        }],
      });

      await removePortMapping('test', 18080, { sandboxRunning: true });
      expect(stopPortProxy).toHaveBeenCalledWith('pm_active');
    });

    it('does not stop proxy when sandbox is not running', async () => {
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        ...freshConfig(),
        ports: [{
          id: 'pm_1', hostPort: 18080, targetPort: 8080,
          protocol: 'tcp', bindAddress: '127.0.0.1',
          status: 'pending', createdAt: '2026-01-01',
        }],
      });

      await removePortMapping('test', 18080);
      expect(stopPortProxy).not.toHaveBeenCalled();
    });
  });

  describe('applyPendingPorts', () => {
    it('transitions pending ports to active and starts proxies', async () => {
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        ...freshConfig(),
        ports: [
          {
            id: 'pm_p1', hostPort: 18090, targetPort: 8080,
            protocol: 'tcp', bindAddress: '127.0.0.1',
            status: 'pending', createdAt: '2026-01-01',
          },
          {
            id: 'pm_a1', hostPort: 18091, targetPort: 8081,
            protocol: 'tcp', bindAddress: '127.0.0.1',
            status: 'active', createdAt: '2026-01-01',
          },
        ],
      });

      await applyPendingPorts('test', 10001, 'arig_sb_test');

      // Only the pending port should have startPortProxy called
      expect(startPortProxy).toHaveBeenCalledTimes(1);
      expect(startPortProxy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pm_p1', status: 'active' }),
        10001,
        'arig_sb_test',
      );
      expect(saveSandboxConfig).toHaveBeenCalled();
    });

    it('skips when no pending ports', async () => {
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        ...freshConfig(),
        ports: [{
          id: 'pm_a1', hostPort: 18091, targetPort: 8081,
          protocol: 'tcp', bindAddress: '127.0.0.1',
          status: 'active', createdAt: '2026-01-01',
        }],
      });

      await applyPendingPorts('test', 10001, 'arig_sb_test');

      expect(startPortProxy).not.toHaveBeenCalled();
      expect(saveSandboxConfig).not.toHaveBeenCalled();
    });

    it('marks port as error when startPortProxy fails', async () => {
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        ...freshConfig(),
        ports: [{
          id: 'pm_fail', hostPort: 18092, targetPort: 8080,
          protocol: 'tcp', bindAddress: '127.0.0.1',
          status: 'pending', createdAt: '2026-01-01',
        }],
      });
      vi.mocked(startPortProxy).mockRejectedValueOnce(
        new Error('Failed to start proxy')
      );

      await applyPendingPorts('test', 10001, 'arig_sb_test');

      const savedConfig = vi.mocked(saveSandboxConfig).mock.calls[0][0] as any;
      expect(savedConfig.ports[0].status).toBe('error');
      expect(savedConfig.ports[0].lastError).toBe('Failed to start proxy');
    });

    it('clears lastError on successful apply', async () => {
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        ...freshConfig(),
        ports: [{
          id: 'pm_retry', hostPort: 18093, targetPort: 8080,
          protocol: 'tcp', bindAddress: '127.0.0.1',
          status: 'pending', createdAt: '2026-01-01',
          lastError: 'previous failure',
        }],
      });

      await applyPendingPorts('test', 10001, 'arig_sb_test');

      const savedConfig = vi.mocked(saveSandboxConfig).mock.calls[0][0] as any;
      expect(savedConfig.ports[0].status).toBe('active');
      expect(savedConfig.ports[0].lastError).toBeUndefined();
    });
  });

  describe('stopAllPorts', () => {
    it('stops active proxies and transitions to pending', async () => {
      getActiveProxies().set('pm_s1', {
        server: {} as any,
        portMapping: {} as any,
        connections: new Set(),
      });

      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        ...freshConfig(),
        ports: [{
          id: 'pm_s1', hostPort: 18094, targetPort: 8080,
          protocol: 'tcp', bindAddress: '127.0.0.1',
          status: 'active', createdAt: '2026-01-01',
        }],
      });

      await stopAllPorts('test');

      expect(stopPortProxy).toHaveBeenCalledWith('pm_s1');
      const savedConfig = vi.mocked(saveSandboxConfig).mock.calls[0][0] as any;
      expect(savedConfig.ports[0].status).toBe('pending');
    });

    it('skips ports not in activeProxies map', async () => {
      // Port is marked active in config but not in the in-memory map
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        ...freshConfig(),
        ports: [{
          id: 'pm_orphan', hostPort: 18095, targetPort: 8080,
          protocol: 'tcp', bindAddress: '127.0.0.1',
          status: 'active', createdAt: '2026-01-01',
        }],
      });

      await stopAllPorts('test');

      expect(stopPortProxy).not.toHaveBeenCalled();
    });

    it('handles empty ports array', async () => {
      await stopAllPorts('test');
      expect(stopPortProxy).not.toHaveBeenCalled();
    });
  });

  describe('listPortMappings', () => {
    it('returns empty array when config has no ports field', async () => {
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        name: 'test', repo: '', branch: '', packages: [],
        vm: { cpus: 1, memory: '1G', disk: '10G' },
        created: '2026-01-01',
        // no ports field
      } as any);

      const result = await listPortMappings('test');
      expect(result).toEqual([]);
    });

    it('returns all ports including error status', async () => {
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        ...freshConfig(),
        ports: [
          {
            id: 'pm_1', hostPort: 18080, targetPort: 8080,
            protocol: 'tcp', bindAddress: '127.0.0.1',
            status: 'active', createdAt: '2026-01-01',
          },
          {
            id: 'pm_2', hostPort: 18081, targetPort: 8081,
            protocol: 'tcp', bindAddress: '127.0.0.1',
            status: 'error', createdAt: '2026-01-01',
            lastError: 'port in use',
          },
        ],
      });

      const result = await listPortMappings('test');
      expect(result).toHaveLength(2);
      expect(result[1].status).toBe('error');
      expect(result[1].lastError).toBe('port in use');
    });
  });
});
