import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, getConfigDir, getDefaultConfig } from './config.js';

describe('config', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('getDefaultConfig', () => {
    it('returns dynamic defaults based on system resources', () => {
      const config = getDefaultConfig();
      // CPUs should be between 2 and 4
      expect(config.vm.cpus).toBeGreaterThanOrEqual(2);
      expect(config.vm.cpus).toBeLessThanOrEqual(4);
      // Memory should be between 2G and 8G
      const memGB = parseInt(config.vm.memory);
      expect(memGB).toBeGreaterThanOrEqual(2);
      expect(memGB).toBeLessThanOrEqual(8);
      // Disk should be fixed at 30G
      expect(config.vm.disk).toBe('30G');
    });
  });

  describe('loadConfig', () => {
    it('returns default config when no config file exists', async () => {
      const config = await loadConfig(testDir);
      const defaultConfig = getDefaultConfig();
      expect(config.vm.cpus).toBe(defaultConfig.vm.cpus);
      expect(config.vm.memory).toBe(defaultConfig.vm.memory);
      expect(config.vm.disk).toBe(defaultConfig.vm.disk);
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
      const defaultConfig = getDefaultConfig();
      expect(config.vm.cpus).toBe(2);
      expect(config.vm.memory).toBe(defaultConfig.vm.memory); // dynamic default
    });
  });

  describe('getConfigDir', () => {
    it('returns ~/.agent-rig by default', () => {
      const dir = getConfigDir();
      expect(dir).toMatch(/\.agent-rig$/);
    });
  });
});
