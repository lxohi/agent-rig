import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, getConfigDir, DEFAULT_CONFIG } from './config.js';

describe('config', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('returns default config when no config file exists', async () => {
      const config = await loadConfig(testDir);
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('loads config from yaml file', async () => {
      await writeFile(
        join(testDir, 'config.yml'),
        'vm:\n  cpus: 8\n  memory: "16G"\n  disk: "50G"'
      );
      const config = await loadConfig(testDir);
      expect(config.vm.cpus).toBe(8);
      expect(config.vm.memory).toBe('16G');
      expect(config.vm.disk).toBe('50G');
    });

    it('merges partial config with defaults', async () => {
      await writeFile(join(testDir, 'config.yml'), 'vm:\n  cpus: 2');
      const config = await loadConfig(testDir);
      expect(config.vm.cpus).toBe(2);
      expect(config.vm.memory).toBe('8G'); // default
    });
  });

  describe('getConfigDir', () => {
    it('returns ~/.agent-rig by default', () => {
      const dir = getConfigDir();
      expect(dir).toMatch(/\.agent-rig$/);
    });
  });
});
