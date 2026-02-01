import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPresets, DEFAULT_PRESETS } from './presets.js';

describe('presets', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadPresets', () => {
    it('returns default presets when no file exists', async () => {
      const presets = await loadPresets(testDir);
      expect(presets).toEqual(DEFAULT_PRESETS);
    });

    it('loads presets from yaml file', async () => {
      await writeFile(
        join(testDir, 'presets.yml'),
        'presets:\n  custom:\n    description: "Custom preset"\n    packages:\n      - node-20'
      );
      const presets = await loadPresets(testDir);
      expect(presets.presets.custom).toBeDefined();
      expect(presets.presets.custom.packages).toEqual(['node-20']);
    });

    it('merges user presets with defaults', async () => {
      await writeFile(
        join(testDir, 'presets.yml'),
        'presets:\n  custom:\n    description: "Custom"\n    packages:\n      - uv'
      );
      const presets = await loadPresets(testDir);
      expect(presets.presets['fullstack-dev']).toBeDefined(); // default
      expect(presets.presets.custom).toBeDefined(); // user
    });
  });
});
