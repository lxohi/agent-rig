import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadUpdateState, saveUpdateState, getInstallDir, type UpdateState } from './update-state.js';

describe('update-state', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadUpdateState', () => {
    it('returns default state when file does not exist', async () => {
      const state = await loadUpdateState(testDir);
      expect(state.currentVersion).toBe('0.0.0');
      expect(state.lastCheck).toBeNull();
    });

    it('loads existing state from file', async () => {
      const existingState = {
        currentVersion: '0.1.0',
        lastCheck: '2026-02-01T12:00:00Z',
        pendingVersion: null,
        pendingPath: null,
        downloadStarted: null,
        downloadPid: null,
      };
      await writeFile(join(testDir, 'update.json'), JSON.stringify(existingState));
      const state = await loadUpdateState(testDir);
      expect(state.currentVersion).toBe('0.1.0');
      expect(state.lastCheck).toBe('2026-02-01T12:00:00Z');
    });
  });

  describe('saveUpdateState', () => {
    it('saves state to file', async () => {
      const state: UpdateState = {
        currentVersion: '0.2.0',
        lastCheck: '2026-02-01T14:00:00Z',
        pendingVersion: null,
        pendingPath: null,
        downloadStarted: null,
        downloadPid: null,
      };
      await saveUpdateState(state, testDir);
      const loaded = await loadUpdateState(testDir);
      expect(loaded.currentVersion).toBe('0.2.0');
    });
  });

  describe('getInstallDir', () => {
    it('returns ~/.arig by default', () => {
      const dir = getInstallDir();
      expect(dir).toMatch(/\.arig$/);
    });
  });
});
