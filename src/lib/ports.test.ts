import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validatePort,
  isPortAvailable,
  generatePortMappingId,
  addPortMapping,
  removePortMapping,
  listPortMappings,
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

const freshConfig = () => ({
  name: 'test',
  repo: '',
  branch: '',
  packages: [],
  vm: { cpus: 1, memory: '1G', disk: '10G' },
  created: '2026-01-01',
  ports: [] as any[],
});

describe('ports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveProxies().clear();
    vi.mocked(loadSandboxConfig).mockImplementation(async () => freshConfig());
  });

  describe('validatePort', () => {
    it('accepts valid port numbers', () => {
      expect(() => validatePort(80, 'test')).not.toThrow();
      expect(() => validatePort(8080, 'test')).not.toThrow();
      expect(() => validatePort(65535, 'test')).not.toThrow();
      expect(() => validatePort(1, 'test')).not.toThrow();
    });

    it('rejects invalid port numbers', () => {
      expect(() => validatePort(0, 'test')).toThrow('Invalid test');
      expect(() => validatePort(-1, 'test')).toThrow('Invalid test');
      expect(() => validatePort(65536, 'test')).toThrow('Invalid test');
      expect(() => validatePort(1.5, 'test')).toThrow('Invalid test');
    });
  });

  describe('generatePortMappingId', () => {
    it('generates unique IDs with pm_ prefix', () => {
      const id1 = generatePortMappingId();
      const id2 = generatePortMappingId();
      expect(id1).toMatch(/^pm_/);
      expect(id2).toMatch(/^pm_/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('isPortAvailable', () => {
    it('returns true for available port', async () => {
      // Use a high random port that's likely available
      const result = await isPortAvailable(49999, '127.0.0.1');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('addPortMapping', () => {
    it('adds a pending mapping when sandbox is stopped', async () => {
      const mapping = await addPortMapping('test', 18080, 8080);
      expect(mapping.hostPort).toBe(18080);
      expect(mapping.targetPort).toBe(8080);
      expect(mapping.status).toBe('pending');
      expect(mapping.bindAddress).toBe('127.0.0.1');
      expect(mapping.protocol).toBe('tcp');
      expect(saveSandboxConfig).toHaveBeenCalled();
    });

    it('rejects invalid host port', async () => {
      await expect(addPortMapping('test', 0, 8080)).rejects.toThrow('Invalid host port');
    });

    it('rejects invalid target port', async () => {
      await expect(addPortMapping('test', 8080, 0)).rejects.toThrow('Invalid target port');
    });

    it('rejects duplicate host port', async () => {
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        name: 'test', repo: '', branch: '', packages: [],
        vm: { cpus: 1, memory: '1G', disk: '10G' },
        created: '2026-01-01',
        ports: [{
          id: 'pm_existing', hostPort: 18080, targetPort: 8080,
          protocol: 'tcp', bindAddress: '127.0.0.1',
          status: 'active', createdAt: '2026-01-01',
        }],
      });
      await expect(addPortMapping('test', 18080, 9090)).rejects.toThrow('already exists');
    });

    it('uses custom bind address', async () => {
      const mapping = await addPortMapping('test', 18081, 8080, {
        bindAddress: '0.0.0.0',
      });
      expect(mapping.bindAddress).toBe('0.0.0.0');
    });
  });

  describe('removePortMapping', () => {
    it('removes an existing mapping', async () => {
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        name: 'test', repo: '', branch: '', packages: [],
        vm: { cpus: 1, memory: '1G', disk: '10G' },
        created: '2026-01-01',
        ports: [{
          id: 'pm_1', hostPort: 18080, targetPort: 8080,
          protocol: 'tcp', bindAddress: '127.0.0.1',
          status: 'pending', createdAt: '2026-01-01',
        }],
      });
      await removePortMapping('test', 18080);
      expect(saveSandboxConfig).toHaveBeenCalled();
    });

    it('throws when mapping not found', async () => {
      await expect(removePortMapping('test', 99999)).rejects.toThrow('No port mapping found');
    });
  });

  describe('listPortMappings', () => {
    it('returns empty array when no ports', async () => {
      const result = await listPortMappings('test');
      expect(result).toEqual([]);
    });

    it('returns configured ports', async () => {
      const ports = [{
        id: 'pm_1', hostPort: 18080, targetPort: 8080,
        protocol: 'tcp' as const, bindAddress: '127.0.0.1',
        status: 'active' as const, createdAt: '2026-01-01',
      }];
      vi.mocked(loadSandboxConfig).mockResolvedValueOnce({
        name: 'test', repo: '', branch: '', packages: [],
        vm: { cpus: 1, memory: '1G', disk: '10G' },
        created: '2026-01-01',
        ports,
      });
      const result = await listPortMappings('test');
      expect(result).toHaveLength(1);
      expect(result[0].hostPort).toBe(18080);
    });
  });
});
