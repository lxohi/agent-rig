import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinuxRootlessDriver, type DestroyResult } from './linux-rootless.js';

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

import { createSandboxUser, deleteSandboxUser } from './linux/user.js';
import { startDaemon, stopDaemon, isDaemonRunning, killUserProcesses } from './linux/daemon.js';
import { setupWorkspace, removeWorkspace, workspaceExists } from './linux/workspace.js';
import { execa } from 'execa';

describe('LinuxRootlessDriver', () => {
  let driver: LinuxRootlessDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new LinuxRootlessDriver();
  });

  it('has name "linux-rootless"', () => {
    expect(driver.name).toBe('linux-rootless');
  });

  describe('list', () => {
    it('returns sandbox infos from /etc/passwd', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: [
          'root:x:0:0:root:/root:/bin/bash',
          'arig_sb_test:x:10001:10001::/home/arig_sb_test:/bin/false',
          'arig_sb_other:x:10002:10002::/home/arig_sb_other:/bin/false',
          'normaluser:x:1000:1000::/home/normaluser:/bin/bash',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await driver.list();
      expect(result).toHaveLength(2);
      expect(result[0].sandboxName).toBe('test');
      expect(result[0].driver).toBe('linux-rootless');
      expect(result[1].sandboxName).toBe('other');
    });

    it('returns empty array when getent fails', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '', stderr: '', exitCode: 2,
      } as any);
      const result = await driver.list();
      expect(result).toEqual([]);
    });

    it('converts underscores back to hyphens in sandboxName', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'arig_sb_my_project:x:10001:10001::/home/arig_sb_my_project:/bin/false',
        stderr: '',
        exitCode: 0,
      } as any);
      const result = await driver.list();
      expect(result[0].sandboxName).toBe('my-project');
    });
  });

  describe('inspect', () => {
    it('returns info for existing sandbox user', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'arig_sb_test:x:10001:10001::/home/arig_sb_test:/bin/false',
        stderr: '', exitCode: 0,
      } as any);

      const result = await driver.inspect('test');
      expect(result).toBeDefined();
      expect(result!.sandboxName).toBe('test');
      expect(result!.driver).toBe('linux-rootless');
      expect(result!.state).toBe('stopped');
    });

    it('returns running state when daemon is active', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'arig_sb_test:x:10001:10001::/home/arig_sb_test:/bin/false',
        stderr: '', exitCode: 0,
      } as any);
      vi.mocked(isDaemonRunning).mockResolvedValueOnce(true);

      const result = await driver.inspect('test');
      expect(result!.state).toBe('running');
    });

    it('returns undefined for non-existent user', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('no such user'));
      const result = await driver.inspect('nope');
      expect(result).toBeUndefined();
    });
  });

  describe('create', () => {
    it('creates user, workspace, and XDG runtime dir', async () => {
      await driver.create('test');

      expect(createSandboxUser).toHaveBeenCalledWith('test', { requestId: undefined });
      expect(setupWorkspace).toHaveBeenCalledWith('arig_sb_test', 10001, {
        requestId: undefined,
        sandboxName: 'test',
      });
      const calls = vi.mocked(execa).mock.calls;
      const mkdirCall = calls.find(
        (c) => c[0] === 'sudo' && c[1]?.includes('/run/user/10001'),
      );
      expect(mkdirCall).toBeDefined();
    });

    it('passes requestId through opts', async () => {
      await driver.create('test', { requestId: 'req-1' });
      expect(createSandboxUser).toHaveBeenCalledWith('test', { requestId: 'req-1' });
    });
  });

  describe('start', () => {
    it('starts daemon for existing sandbox', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'arig_sb_test:x:10001:10001::/home/arig_sb_test:/bin/false',
        stderr: '', exitCode: 0,
      } as any);

      await driver.start('test');
      expect(startDaemon).toHaveBeenCalledWith({
        username: 'arig_sb_test',
        uid: 10001,
        sandboxName: 'test',
      });
    });

    it('throws when user does not exist', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('no such user'));
      await expect(driver.start('nope')).rejects.toThrow('does not exist');
    });
  });

  describe('stop', () => {
    it('stops daemon for existing sandbox', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'arig_sb_test:x:10001:10001::/home/arig_sb_test:/bin/false',
        stderr: '', exitCode: 0,
      } as any);

      await driver.stop('test');
      expect(stopDaemon).toHaveBeenCalledWith({
        username: 'arig_sb_test',
        uid: 10001,
        sandboxName: 'test',
      });
    });

    it('throws when user does not exist', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('no such user'));
      await expect(driver.stop('nope')).rejects.toThrow('does not exist');
    });
  });

  describe('destroy', () => {
    it('runs full destroy sequence successfully', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'arig_sb_test:x:10001:10001::/home/arig_sb_test:/bin/false',
        stderr: '', exitCode: 0,
      } as any);

      await driver.destroy('test');

      expect(stopDaemon).toHaveBeenCalled();
      expect(killUserProcesses).toHaveBeenCalledWith(10001, 'arig_sb_test');
      expect(removeWorkspace).toHaveBeenCalledWith('arig_sb_test', { sandboxName: 'test' });
      expect(deleteSandboxUser).toHaveBeenCalledWith('test');
    });

    it('skips daemon/process steps when user does not exist', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('no such user'));

      await driver.destroy('test');

      expect(stopDaemon).not.toHaveBeenCalled();
      expect(killUserProcesses).not.toHaveBeenCalled();
      expect(removeWorkspace).toHaveBeenCalled();
      expect(deleteSandboxUser).toHaveBeenCalled();
    });

    it('marks partial when retryable step fails', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'arig_sb_test:x:10001:10001::/home/arig_sb_test:/bin/false',
        stderr: '', exitCode: 0,
      } as any);
      vi.mocked(stopDaemon).mockRejectedValue(new Error('daemon stop failed'));

      // Retryable failure = partial, not thrown
      await driver.destroy('test');
    });

    it('throws on non-retryable step failure', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'arig_sb_test:x:10001:10001::/home/arig_sb_test:/bin/false',
        stderr: '', exitCode: 0,
      } as any);
      vi.mocked(deleteSandboxUser).mockRejectedValueOnce(new Error('user delete failed'));

      // Non-retryable failure = failure, thrown
      await expect(driver.destroy('test')).rejects.toThrow('Destroy failed');
    });
  });

  describe('execRun', () => {
    it('runs docker command as sandbox user', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'arig_sb_test:x:10001:10001::/home/arig_sb_test:/bin/false',
        stderr: '', exitCode: 0,
      } as any);
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'hello', stderr: '', exitCode: 0,
      } as any);

      const result = await driver.execRun('test', ['ps']);
      expect(result.stdout).toBe('hello');
      expect(result.exitCode).toBe(0);
    });

    it('throws when user does not exist', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('no such user'));
      await expect(driver.execRun('nope', ['ps'])).rejects.toThrow('does not exist');
    });
  });

  describe('unimplemented methods', () => {
    it('startExecSession throws', async () => {
      await expect(driver.startExecSession('test', ['sh'])).rejects.toThrow('not yet implemented');
    });

    it('startAttachSession throws', async () => {
      await expect(driver.startAttachSession('test')).rejects.toThrow('not yet implemented');
    });
  });
});

