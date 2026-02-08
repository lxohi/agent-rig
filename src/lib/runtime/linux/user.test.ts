import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sandboxUsername, createSandboxUser, deleteSandboxUser } from './user.js';

vi.mock('../../root-helper-client.js', () => ({
  invokeRootHelper: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  validateSandboxUsername: vi.fn(),
}));

vi.mock('../../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({
    stdout: 'arig_sb_test:x:10001:10001::/home/arig_sb_test:/bin/false',
    stderr: '',
    exitCode: 0,
  }),
}));

import { invokeRootHelper } from '../../root-helper-client.js';
import { execa } from 'execa';

describe('linux/user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sandboxUsername', () => {
    it('prefixes with arig_sb_', () => {
      expect(sandboxUsername('test')).toBe('arig_sb_test');
    });

    it('replaces hyphens with underscores', () => {
      expect(sandboxUsername('my-project')).toBe('arig_sb_my_project');
    });

    it('preserves underscores', () => {
      expect(sandboxUsername('my_project')).toBe('arig_sb_my_project');
    });

    it('handles numeric names', () => {
      expect(sandboxUsername('sb123')).toBe('arig_sb_sb123');
    });
  });

  describe('createSandboxUser', () => {
    it('calls root helper with create-user', async () => {
      const result = await createSandboxUser('test');
      expect(invokeRootHelper).toHaveBeenCalledWith(
        'create-user', 'arig_sb_test', undefined,
      );
      expect(result.username).toBe('arig_sb_test');
      expect(result.uid).toBe(10001);
    });

    it('passes requestId to root helper', async () => {
      await createSandboxUser('test', { requestId: 'req-1' });
      expect(invokeRootHelper).toHaveBeenCalledWith(
        'create-user', 'arig_sb_test', { requestId: 'req-1' },
      );
    });

    it('converts hyphens in sandbox name', async () => {
      await createSandboxUser('my-project');
      expect(invokeRootHelper).toHaveBeenCalledWith(
        'create-user', 'arig_sb_my_project', undefined,
      );
    });

    it('throws when getent fails', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('not found'));
      // invokeRootHelper succeeds but getent (resolveUid) fails
      vi.mocked(execa).mockRejectedValueOnce(new Error('getent failed'));
      await expect(createSandboxUser('bad')).rejects.toThrow('Failed to resolve uid');
    });
  });

  describe('deleteSandboxUser', () => {
    it('calls root helper with delete-user', async () => {
      await deleteSandboxUser('test');
      expect(invokeRootHelper).toHaveBeenCalledWith(
        'delete-user', 'arig_sb_test', undefined,
      );
    });

    it('passes requestId to root helper', async () => {
      await deleteSandboxUser('test', { requestId: 'req-2' });
      expect(invokeRootHelper).toHaveBeenCalledWith(
        'delete-user', 'arig_sb_test', { requestId: 'req-2' },
      );
    });
  });
});
