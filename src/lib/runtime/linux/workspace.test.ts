import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspacePaths, setupWorkspace, removeWorkspace, workspaceExists } from './workspace.js';

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execa } from 'execa';
import { access } from 'node:fs/promises';

describe('linux/workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('workspacePaths', () => {
    it('computes correct paths', () => {
      const paths = workspacePaths('arig_sb_test');
      expect(paths.home).toBe('/home/arig_sb_test');
      expect(paths.workspace).toBe('/home/arig_sb_test/workspace');
      expect(paths.configDir).toBe('/home/arig_sb_test/.config/agent-rig');
    });
  });

  describe('setupWorkspace', () => {
    it('creates directories with correct ownership', async () => {
      const paths = await setupWorkspace('arig_sb_test', 10001);
      expect(paths.home).toBe('/home/arig_sb_test');

      const calls = vi.mocked(execa).mock.calls;
      // Should have mkdir, chown, chmod for each of 3 dirs
      const mkdirCalls = calls.filter(
        (c) => c[0] === 'sudo' && c[1]?.includes('mkdir'),
      );
      expect(mkdirCalls.length).toBe(3);
    });

    it('sets correct chown uid:uid', async () => {
      await setupWorkspace('arig_sb_test', 10001);
      const calls = vi.mocked(execa).mock.calls;
      const chownCalls = calls.filter(
        (c) => c[0] === 'sudo' && c[1]?.includes('chown'),
      );
      expect(chownCalls.length).toBe(3);
      for (const call of chownCalls) {
        expect(call[1]).toContain('10001:10001');
      }
    });

    it('passes sandbox name in opts', async () => {
      await setupWorkspace('arig_sb_test', 10001, {
        sandboxName: 'test',
        requestId: 'req-1',
      });
      // Should not throw
    });
  });

  describe('removeWorkspace', () => {
    it('removes home directory via sudo rm -rf', async () => {
      await removeWorkspace('arig_sb_test');
      const calls = vi.mocked(execa).mock.calls;
      const rmCall = calls.find(
        (c) => c[0] === 'sudo' && c[1]?.includes('rm'),
      );
      expect(rmCall).toBeDefined();
      expect(rmCall![1]).toContain('/home/arig_sb_test');
    });

    it('throws when rm fails', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('permission denied'));
      await expect(removeWorkspace('arig_sb_test')).rejects.toThrow('permission denied');
    });
  });

  describe('workspaceExists', () => {
    it('returns true when home directory exists', async () => {
      vi.mocked(access).mockResolvedValueOnce(undefined);
      const result = await workspaceExists('arig_sb_test');
      expect(result).toBe(true);
    });

    it('returns false when home directory does not exist', async () => {
      vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'));
      const result = await workspaceExists('arig_sb_test');
      expect(result).toBe(false);
    });
  });
});
