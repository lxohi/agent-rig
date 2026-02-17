import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSandboxConfig,
  saveSandboxConfig,
  listSandboxes,
  deleteSandboxConfig,
} from './sandbox.js';
import type { SandboxConfig, PortMapping } from './types.js';

describe('sandbox', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
    await mkdir(join(testDir, 'sandboxes'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('saveSandboxConfig', () => {
    it('saves sandbox config to correct location', async () => {
      const config = {
        name: 'test-sandbox',
        repo: 'https://github.com/user/repo.git',
        branch: 'main',
        packages: ['java-17', 'node-20'],
        vm: { cpus: 4, memory: '8G', disk: '30G' },
        created: '2026-01-01T00:00:00Z',
      };
      await saveSandboxConfig(config, testDir);
      const content = await readFile(
        join(testDir, 'sandboxes', 'test-sandbox', 'config.yml'),
        'utf-8'
      );
      expect(content).toContain('test-sandbox');
    });
  });

  describe('loadSandboxConfig', () => {
    it('loads existing sandbox config', async () => {
      await mkdir(join(testDir, 'sandboxes', 'my-sandbox'), { recursive: true });
      await writeFile(
        join(testDir, 'sandboxes', 'my-sandbox', 'config.yml'),
        'name: my-sandbox\nrepo: https://github.com/test/repo.git\nbranch: main\npackages: []\nvm:\n  cpus: 4\n  memory: "8G"\n  disk: "30G"\ncreated: "2026-01-01T00:00:00Z"'
      );
      const config = await loadSandboxConfig('my-sandbox', testDir);
      expect(config.name).toBe('my-sandbox');
      expect(config.repo).toBe('https://github.com/test/repo.git');
    });

    it('throws when sandbox does not exist', async () => {
      await expect(loadSandboxConfig('nonexistent', testDir)).rejects.toThrow();
    });
  });

  describe('listSandboxes', () => {
    it('lists all sandbox names', async () => {
      await mkdir(join(testDir, 'sandboxes', 'sandbox-a'), { recursive: true });
      await mkdir(join(testDir, 'sandboxes', 'sandbox-b'), { recursive: true });
      await writeFile(join(testDir, 'sandboxes', 'sandbox-a', 'config.yml'), 'name: sandbox-a');
      await writeFile(join(testDir, 'sandboxes', 'sandbox-b', 'config.yml'), 'name: sandbox-b');
      const sandboxes = await listSandboxes(testDir);
      expect(sandboxes).toContain('sandbox-a');
      expect(sandboxes).toContain('sandbox-b');
    });

    it('returns empty array when no sandboxes', async () => {
      const sandboxes = await listSandboxes(testDir);
      expect(sandboxes).toEqual([]);
    });
  });

  describe('deleteSandboxConfig', () => {
    it('removes sandbox config directory', async () => {
      await mkdir(join(testDir, 'sandboxes', 'to-delete'), { recursive: true });
      await writeFile(join(testDir, 'sandboxes', 'to-delete', 'config.yml'), 'name: to-delete');
      await deleteSandboxConfig('to-delete', testDir);
      const sandboxes = await listSandboxes(testDir);
      expect(sandboxes).not.toContain('to-delete');
    });
  });

  describe('backward compatibility', () => {
    it('loads old config without new fields and applies defaults', async () => {
      await mkdir(join(testDir, 'sandboxes', 'old-sandbox'), { recursive: true });
      await writeFile(
        join(testDir, 'sandboxes', 'old-sandbox', 'config.yml'),
        'name: old-sandbox\nrepo: https://github.com/test/repo.git\nbranch: main\npackages: []\nvm:\n  cpus: 4\n  memory: "8G"\n  disk: "30G"\ncreated: "2026-01-01T00:00:00Z"'
      );
      const config = await loadSandboxConfig('old-sandbox', testDir);
      expect(config.runtime).toBeUndefined();
      expect(config.tools).toEqual([]);
      expect(config.ports).toEqual([]);
    });
  });

  describe('new config fields', () => {
    const baseConfig: SandboxConfig = {
      name: 'new-sandbox',
      repo: 'https://github.com/test/repo.git',
      branch: 'main',
      packages: [],
      vm: { cpus: 4, memory: '8G', disk: '30G' },
      created: '2026-01-01T00:00:00Z',
    };

    it('persists and loads runtime field', async () => {
      const config: SandboxConfig = {
        ...baseConfig,
        runtime: {
          driver: 'linux-rootless',
          sandboxId: 'sb-abc123',
          sandboxUser: 'sandbox_1001',
          stateVersion: '1',
        },
      };
      await saveSandboxConfig(config, testDir);
      const loaded = await loadSandboxConfig('new-sandbox', testDir);
      expect(loaded.runtime).toEqual(config.runtime);
    });

    it('persists and loads tools field', async () => {
      const config: SandboxConfig = {
        ...baseConfig,
        tools: ['java-17', 'node-22'],
      };
      await saveSandboxConfig(config, testDir);
      const loaded = await loadSandboxConfig('new-sandbox', testDir);
      expect(loaded.tools).toEqual(['java-17', 'node-22']);
    });

    it('persists and loads ports field', async () => {
      const port: PortMapping = {
        id: 'port-1',
        hostPort: 8080,
        targetPort: 80,
        protocol: 'tcp',
        bindAddress: '127.0.0.1',
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
      };
      const config: SandboxConfig = {
        ...baseConfig,
        ports: [port],
      };
      await saveSandboxConfig(config, testDir);
      const loaded = await loadSandboxConfig('new-sandbox', testDir);
      expect(loaded.ports).toEqual([port]);
    });

    it('persists port with lastError field', async () => {
      const port: PortMapping = {
        id: 'port-err',
        hostPort: 9090,
        targetPort: 90,
        protocol: 'tcp',
        bindAddress: '127.0.0.1',
        status: 'error',
        createdAt: '2026-01-01T00:00:00Z',
        lastError: 'EADDRINUSE',
      };
      const config: SandboxConfig = {
        ...baseConfig,
        ports: [port],
      };
      await saveSandboxConfig(config, testDir);
      const loaded = await loadSandboxConfig('new-sandbox', testDir);
      expect(loaded.ports![0].lastError).toBe('EADDRINUSE');
      expect(loaded.ports![0].status).toBe('error');
    });
  });

  describe('save/load idempotency', () => {
    it('save then load then save produces identical YAML', async () => {
      const config: SandboxConfig = {
        name: 'idempotent',
        repo: 'https://github.com/test/repo.git',
        branch: 'main',
        packages: ['node-22'],
        vm: { cpus: 2, memory: '4G', disk: '20G' },
        created: '2026-01-01T00:00:00Z',
        runtime: {
          driver: 'linux-rootless',
          sandboxId: 'sb-xyz',
          sandboxUser: 'sandbox_1002',
          stateVersion: '1',
        },
        tools: ['java-17'],
        ports: [
          {
            id: 'p1',
            hostPort: 3000,
            targetPort: 3000,
            protocol: 'tcp',
            bindAddress: '127.0.0.1',
            status: 'active',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      };

      await saveSandboxConfig(config, testDir);
      const first = await readFile(
        join(testDir, 'sandboxes', 'idempotent', 'config.yml'),
        'utf-8'
      );

      const loaded = await loadSandboxConfig('idempotent', testDir);
      await saveSandboxConfig(loaded, testDir);
      const second = await readFile(
        join(testDir, 'sandboxes', 'idempotent', 'config.yml'),
        'utf-8'
      );

      expect(second).toBe(first);
    });
  });
});
