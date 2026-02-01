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
});
