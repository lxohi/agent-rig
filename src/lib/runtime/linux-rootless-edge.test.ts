import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinuxRootlessDriver } from './linux-rootless.js';

// Mock all dependencies
vi.mock('./linux/user.js', () => ({
  sandboxUsername: vi.fn((name: string) => `arig_sb_${name.replace(/-/g, '_')}`),
  createSandboxUser: vi.fn().mockResolvedValue({ username: 'arig_sb_test', uid: 10001 }),
  deleteSandboxUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./linux/daemon.js', () => ({
  startDaemon: vi.fn().mockResolvedValue(undefined),
  stopDaemon: vi.fn().mockResolvedValue(undefined),
  isDaemonRunning: vi.fn().mockResolvedValue(false),
  killUserProcesses: vi.fn().mockResolvedValue(undefined),
  daemonPaths: vi.fn((uid: number, username: string) => ({
    socketPath: `/run/user/${uid}/docker.sock`,
    dataRoot: `/home/${username}/.local/share/docker`,
    configDir: `/home/${username}/.config/docker`,
    pidFile: `/run/user/${uid}/dockerd.pid`,
  })),
}));

vi.mock('./linux/workspace.js', () => ({
  setupWorkspace: vi.fn().mockResolvedValue({
    home: '/home/arig_sb_test',
    workspace: '/home/arig_sb_test/workspace',
    configDir: '/home/arig_sb_test/.config/agent-rig',
  }),
  removeWorkspace: vi.fn().mockResolvedValue(undefined),
  workspaceExists: vi.fn().mockResolvedValue(true),
  workspacePaths: vi.fn((username: string) => ({
    home: `/home/${username}`,
    workspace: `/home/${username}/workspace`,
    configDir: `/home/${username}/.config/agent-rig`,
  })),
}));

vi.mock('../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../ports.js', () => ({
  stopAllPorts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

import { deleteSandboxUser } from './linux/user.js';
import { stopDaemon, isDaemonRunning, killUserProcesses } from './linux/daemon.js';
import { removeWorkspace, workspaceExists } from './linux/workspace.js';
import { execa } from 'execa';

describe('LinuxRootlessDriver edge cases', () => {
  let driver: LinuxRootlessDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new LinuxRootlessDriver();
  });

  function mockGetentUser(username = 'arig_sb_test', uid = 10001) {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: `${username}:x:${uid}:${uid}::/home/${username}:/bin/false`,
      stderr: '', exitCode: 0,
    } as any);
  }

  describe('destroy with already-deleted user', () => {
    it('skips daemon/kill steps and still cleans workspace+user', async () => {
      // getent fails — user already deleted
      vi.mocked(execa).mockRejectedValueOnce(new Error('no such user'));

      await driver.destroy('test');

      // Daemon and kill steps should be skipped
      expect(stopDaemon).not.toHaveBeenCalled();
      expect(killUserProcesses).not.toHaveBeenCalled();
      // Workspace removal and user deletion should still be attempted
      expect(removeWorkspace).toHaveBeenCalled();
      expect(deleteSandboxUser).toHaveBeenCalled();
    });

    it('succeeds when workspace-remove fails once then succeeds on retry', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('no such user'));
      vi.mocked(removeWorkspace).mockRejectedValueOnce(
        new Error('No such file or directory')
      );
      // removeWorkspace fails once, then default mock succeeds on retry
      // deleteSandboxUser is idempotent (root helper handles non-existent user)

      // Should not throw — workspace-remove succeeds on retry
      await driver.destroy('test');
    });
  });

  describe('destroy partial failure (destroy_degraded)', () => {
    it('throws when non-retryable user-delete fails', async () => {
      mockGetentUser();
      vi.mocked(deleteSandboxUser).mockRejectedValueOnce(
        new Error('userdel: cannot remove user')
      );

      // Non-retryable failure = 'failure' result, throws
      await expect(driver.destroy('test')).rejects.toThrow('Destroy failed');

      // Other steps should have completed before the non-retryable step
      expect(stopDaemon).toHaveBeenCalled();
      expect(killUserProcesses).toHaveBeenCalled();
      expect(removeWorkspace).toHaveBeenCalled();
    });

    it('does not throw when retryable step exhausts all retries', async () => {
      mockGetentUser();
      vi.mocked(stopDaemon)
        .mockRejectedValueOnce(new Error('daemon stuck'))
        .mockRejectedValueOnce(new Error('daemon stuck'))
        .mockRejectedValueOnce(new Error('daemon stuck'));

      // All-retryable failures = 'partial' result, does NOT throw
      await driver.destroy('test');
    });

    it('retries retryable steps before giving up', async () => {
      mockGetentUser();
      // stopDaemon fails all 3 attempts (1 initial + 2 retries)
      vi.mocked(stopDaemon)
        .mockRejectedValueOnce(new Error('daemon stuck'))
        .mockRejectedValueOnce(new Error('daemon stuck'))
        .mockRejectedValueOnce(new Error('daemon stuck'));

      // All-retryable = 'partial', does NOT throw
      await driver.destroy('test');

      // stopDaemon should have been called 3 times (1 + 2 retries)
      expect(stopDaemon).toHaveBeenCalledTimes(3);
    }, 15000);
  });

  describe('start when already running', () => {
    it('startDaemon is called regardless of current state', async () => {
      mockGetentUser();
      vi.mocked(isDaemonRunning).mockResolvedValueOnce(true);

      // start() does not check if already running — it delegates to startDaemon
      await driver.start('test');
      expect(isDaemonRunning).not.toHaveBeenCalled();
    });
  });

  describe('stop when already stopped', () => {
    it('stopDaemon is called regardless of current state', async () => {
      mockGetentUser();

      // stop() does not check if already stopped — it delegates to stopDaemon
      await driver.stop('test');
      expect(stopDaemon).toHaveBeenCalled();
    });
  });

  describe('list with mixed daemon states', () => {
    it('correctly reports running and stopped sandboxes', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: [
          'arig_sb_running:x:10001:10001::/home/arig_sb_running:/bin/false',
          'arig_sb_stopped:x:10002:10002::/home/arig_sb_stopped:/bin/false',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      } as any);

      // Reset isDaemonRunning to return specific values in order
      vi.mocked(isDaemonRunning).mockReset();
      vi.mocked(isDaemonRunning)
        .mockResolvedValueOnce(true)   // arig_sb_running
        .mockResolvedValueOnce(false); // arig_sb_stopped

      const result = await driver.list();
      expect(result).toHaveLength(2);
      expect(result[0].sandboxName).toBe('running');
      expect(result[0].state).toBe('running');
      expect(result[1].sandboxName).toBe('stopped');
      expect(result[1].state).toBe('stopped');
    });
  });

  describe('inspect edge cases', () => {
    it('returns unknown state when workspace does not exist', async () => {
      mockGetentUser();
      vi.mocked(isDaemonRunning).mockResolvedValueOnce(false);
      vi.mocked(workspaceExists).mockResolvedValueOnce(false);

      const result = await driver.inspect('test');
      expect(result).toBeDefined();
      expect(result!.state).toBe('unknown');
    });

    it('includes meta with uid, username, hasWorkspace', async () => {
      mockGetentUser();
      vi.mocked(isDaemonRunning).mockResolvedValueOnce(false);
      vi.mocked(workspaceExists).mockResolvedValueOnce(true);

      const result = await driver.inspect('test');
      expect(result!.meta).toEqual({
        uid: 10001,
        username: 'arig_sb_test',
        hasWorkspace: true,
      });
    });
  });

  describe('execRun edge cases', () => {
    it('returns non-zero exit code on command failure', async () => {
      mockGetentUser();
      vi.mocked(execa).mockRejectedValueOnce({
        stdout: '', stderr: 'container not found', exitCode: 125,
      });

      const result = await driver.execRun('test', ['ps']);
      expect(result.exitCode).toBe(125);
      expect(result.stderr).toBe('container not found');
    });

    it('returns exitCode 1 when error has no exitCode', async () => {
      mockGetentUser();
      vi.mocked(execa).mockRejectedValueOnce(new Error('unknown error'));

      const result = await driver.execRun('test', ['ps']);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('username derivation round-trip', () => {
    it('list converts underscores back to hyphens consistently', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'arig_sb_my_cool_project:x:10001:10001::/home/arig_sb_my_cool_project:/bin/false',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await driver.list();
      // arig_sb_my_cool_project → my-cool-project
      expect(result[0].sandboxName).toBe('my-cool-project');
    });
  });
});
