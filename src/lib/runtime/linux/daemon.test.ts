import { describe, it, expect, vi, beforeEach } from 'vitest';
import { daemonPaths, isDaemonRunning, startDaemon, stopDaemon, killUserProcesses } from './daemon.js';

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execa } from 'execa';
import { access } from 'node:fs/promises';

describe('linux/daemon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('daemonPaths', () => {
    it('computes correct paths from uid and username', () => {
      const paths = daemonPaths(10001, 'arig_sb_test');
      expect(paths.socketPath).toBe('/run/user/10001/docker.sock');
      expect(paths.dataRoot).toBe('/home/arig_sb_test/.local/share/docker');
      expect(paths.configDir).toBe('/home/arig_sb_test/.config/docker');
      expect(paths.pidFile).toBe('/run/user/10001/dockerd.pid');
    });
  });

  describe('isDaemonRunning', () => {
    it('returns true when systemctl reports active', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'active', stderr: '', exitCode: 0,
      } as any);
      const result = await isDaemonRunning(10001, 'arig_sb_test');
      expect(result).toBe(true);
    });

    it('returns false when systemctl reports inactive', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'inactive', stderr: '', exitCode: 3,
      } as any);
      const result = await isDaemonRunning(10001, 'arig_sb_test');
      expect(result).toBe(false);
    });

    it('returns false when execa throws', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('no such user'));
      const result = await isDaemonRunning(10001, 'arig_sb_test');
      expect(result).toBe(false);
    });
  });

  describe('startDaemon', () => {
    it('creates directories and starts docker service', async () => {
      const config = { username: 'arig_sb_test', uid: 10001, sandboxName: 'test' };
      await startDaemon(config);

      // Should have called execa multiple times for mkdir, tee, setup, systemctl
      expect(execa).toHaveBeenCalled();
      const calls = vi.mocked(execa).mock.calls;
      // Verify mkdir calls for data-root and config dir
      const mkdirCalls = calls.filter(
        (c) => c[0] === 'sudo' && c[1]?.includes('mkdir'),
      );
      expect(mkdirCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('stopDaemon', () => {
    it('calls systemctl stop', async () => {
      const config = { username: 'arig_sb_test', uid: 10001, sandboxName: 'test' };
      await stopDaemon(config);

      const calls = vi.mocked(execa).mock.calls;
      const stopCall = calls.find(
        (c) => c[0] === 'sudo' && c[1]?.includes('stop'),
      );
      expect(stopCall).toBeDefined();
    });

    it('falls back to kill on systemctl failure', async () => {
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('systemctl failed'));
      // pkill calls should succeed
      const config = { username: 'arig_sb_test', uid: 10001, sandboxName: 'test' };
      await stopDaemon(config);

      const calls = vi.mocked(execa).mock.calls;
      const pkillCall = calls.find(
        (c) => c[0] === 'sudo' && c[1]?.includes('pkill'),
      );
      expect(pkillCall).toBeDefined();
    });
  });

  describe('killUserProcesses', () => {
    it('calls pkill then pkill -9', async () => {
      await killUserProcesses(10001, 'arig_sb_test');
      const calls = vi.mocked(execa).mock.calls;
      const pkillCalls = calls.filter(
        (c) => c[0] === 'sudo' && c[1]?.[0] === 'pkill',
      );
      expect(pkillCalls.length).toBe(2);
      expect(pkillCalls[1][1]).toContain('-9');
    });
  });
});
