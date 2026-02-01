import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAndSwap, shouldCheckForUpdate, COOLDOWN_HOURS } from './updater.js';

describe('updater', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
    await mkdir(join(testDir, 'bin'), { recursive: true });
    await mkdir(join(testDir, 'versions', '0.1.0'), { recursive: true });
    await writeFile(join(testDir, 'versions', '0.1.0', 'arig'), '#!/bin/bash\necho v0.1.0');
    await chmod(join(testDir, 'versions', '0.1.0', 'arig'), 0o755);
    await symlink('../versions/0.1.0/arig', join(testDir, 'bin', 'arig'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('shouldCheckForUpdate', () => {
    it('returns true when lastCheck is null', () => {
      expect(shouldCheckForUpdate(null)).toBe(true);
    });

    it('returns true when lastCheck is older than cooldown', () => {
      const oldDate = new Date(Date.now() - (COOLDOWN_HOURS + 1) * 60 * 60 * 1000).toISOString();
      expect(shouldCheckForUpdate(oldDate)).toBe(true);
    });

    it('returns false when lastCheck is recent', () => {
      const recentDate = new Date().toISOString();
      expect(shouldCheckForUpdate(recentDate)).toBe(false);
    });
  });

  describe('checkAndSwap', () => {
    it('swaps to pending version when valid', async () => {
      // Setup pending version
      await mkdir(join(testDir, 'staging', '0.2.0'), { recursive: true });
      await writeFile(join(testDir, 'staging', '0.2.0', 'arig'), '#!/bin/bash\necho v0.2.0');
      await chmod(join(testDir, 'staging', '0.2.0', 'arig'), 0o755);

      // Also create in versions dir for symlink target
      await mkdir(join(testDir, 'versions', '0.2.0'), { recursive: true });
      await writeFile(join(testDir, 'versions', '0.2.0', 'arig'), '#!/bin/bash\necho v0.2.0');
      await chmod(join(testDir, 'versions', '0.2.0', 'arig'), 0o755);

      const state = {
        currentVersion: '0.1.0',
        lastCheck: new Date().toISOString(),
        pendingVersion: '0.2.0',
        pendingPath: join(testDir, 'staging', '0.2.0', 'arig'),
        downloadStarted: null,
        downloadPid: null,
      };
      await writeFile(join(testDir, 'update.json'), JSON.stringify(state));

      const result = await checkAndSwap(testDir);
      expect(result.swapped).toBe(true);
      expect(result.newVersion).toBe('0.2.0');
    });

    it('clears invalid pending version', async () => {
      const state = {
        currentVersion: '0.1.0',
        lastCheck: new Date().toISOString(),
        pendingVersion: '0.2.0',
        pendingPath: join(testDir, 'staging', '0.2.0', 'arig'), // Does not exist
        downloadStarted: null,
        downloadPid: null,
      };
      await writeFile(join(testDir, 'update.json'), JSON.stringify(state));

      const result = await checkAndSwap(testDir);
      expect(result.swapped).toBe(false);
    });
  });
});
