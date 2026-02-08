import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateSandboxUsername,
  RootHelperError,
  isRootHelperInstalled,
  invokeRootHelper,
} from './root-helper-client.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

// Mock logger
vi.mock('./logging.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { execa } from 'execa';
import { access } from 'node:fs/promises';
import { logger } from './logging.js';

describe('root-helper-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateSandboxUsername', () => {
    it('accepts valid sandbox usernames', () => {
      expect(() => validateSandboxUsername('arig_sb_test')).not.toThrow();
      expect(() => validateSandboxUsername('arig_sb_my-project')).not.toThrow();
      expect(() => validateSandboxUsername('arig_sb_123')).not.toThrow();
      expect(() => validateSandboxUsername('arig_sb_a_b-c')).not.toThrow();
    });

    it('rejects empty username', () => {
      expect(() => validateSandboxUsername('')).toThrow(RootHelperError);
      expect(() => validateSandboxUsername('')).toThrow('required');
    });

    it('rejects usernames without arig_sb_ prefix', () => {
      expect(() => validateSandboxUsername('root')).toThrow(RootHelperError);
      expect(() => validateSandboxUsername('admin')).toThrow(RootHelperError);
      expect(() => validateSandboxUsername('test_user')).toThrow(RootHelperError);
    });

    it('rejects usernames with path traversal', () => {
      expect(() => validateSandboxUsername('arig_sb_../etc')).toThrow(RootHelperError);
    });

    it('rejects usernames with shell metacharacters', () => {
      expect(() => validateSandboxUsername('arig_sb_; rm -rf /')).toThrow(RootHelperError);
      expect(() => validateSandboxUsername('arig_sb_$(whoami)')).toThrow(RootHelperError);
      expect(() => validateSandboxUsername('arig_sb_`id`')).toThrow(RootHelperError);
    });

    it('rejects usernames with uppercase letters', () => {
      expect(() => validateSandboxUsername('arig_sb_Test')).toThrow(RootHelperError);
    });

    it('sets error code to INVALID_USERNAME', () => {
      try {
        validateSandboxUsername('bad');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RootHelperError);
        expect((err as RootHelperError).code).toBe('INVALID_USERNAME');
      }
    });
  });

  describe('isRootHelperInstalled', () => {
    it('returns true when helper exists and is executable', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      expect(await isRootHelperInstalled()).toBe(true);
    });

    it('returns false when helper does not exist', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
      expect(await isRootHelperInstalled()).toBe(false);
    });
  });

  describe('invokeRootHelper', () => {
    it('rejects invalid username before calling sudo', async () => {
      await expect(
        invokeRootHelper('create-user', 'bad-name')
      ).rejects.toThrow(RootHelperError);
      expect(execa).not.toHaveBeenCalled();
    });

    it('throws NOT_INSTALLED when helper is missing', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
      try {
        await invokeRootHelper('create-user', 'arig_sb_test');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RootHelperError);
        expect((err as RootHelperError).code).toBe('NOT_INSTALLED');
      }
    });

    it('calls sudo with correct arguments on success', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(execa).mockResolvedValue({
        stdout: 'ok',
        stderr: '',
      } as never);

      const result = await invokeRootHelper('create-user', 'arig_sb_test', {
        requestId: 'req-1',
      });

      expect(execa).toHaveBeenCalledWith('sudo', [
        '/usr/local/libexec/arigd-root-helper',
        'create-user',
        'arig_sb_test',
      ]);
      expect(result.stdout).toBe('ok');
    });

    it('logs invocation and success', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(execa).mockResolvedValue({
        stdout: '',
        stderr: '',
      } as never);

      await invokeRootHelper('delete-user', 'arig_sb_x');

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('delete-user arig_sb_x'),
        expect.objectContaining({
          component: 'root-helper',
          event: 'root-helper.delete-user',
          sandbox: 'arig_sb_x',
        }),
      );
    });

    it('throws PERMISSION_DENIED on sudo permission error', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(execa).mockRejectedValue({
        stderr: 'user is not allowed - permission denied',
        exitCode: 1,
      });

      try {
        await invokeRootHelper('create-user', 'arig_sb_test');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RootHelperError);
        expect((err as RootHelperError).code).toBe('PERMISSION_DENIED');
      }
    });

    it('throws EXEC_FAILED on general execution error', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(execa).mockRejectedValue({
        stderr: 'useradd: cannot create user',
        exitCode: 1,
      });

      try {
        await invokeRootHelper('create-user', 'arig_sb_test');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RootHelperError);
        expect((err as RootHelperError).code).toBe('EXEC_FAILED');
      }
    });

    it('logs errors on failure', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      vi.mocked(execa).mockRejectedValue({
        stderr: 'some error',
        exitCode: 1,
      });

      await expect(
        invokeRootHelper('ensure-slice', 'arig_sb_test')
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalled();
    });
  });
});
