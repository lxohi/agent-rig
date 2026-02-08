import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRuntime } from './index.js';

// Mock the lima module
vi.mock('../lima.js', () => ({
  limaList: vi.fn(),
  limaStart: vi.fn(),
  limaStop: vi.fn(),
  limaDelete: vi.fn(),
  limaCreate: vi.fn(),
  limaExec: vi.fn(),
  getSandboxVMName: vi.fn((name: string) => `arig-${name}`),
}));

import { limaList, limaExec } from '../lima.js';

describe('runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRuntime', () => {
    it('returns a driver with name "lima"', () => {
      const driver = createRuntime();
      expect(driver.name).toBe('lima');
    });

    it('returns a driver without options', () => {
      const driver = createRuntime();
      expect(driver).toBeDefined();
      expect(typeof driver.list).toBe('function');
      expect(typeof driver.inspect).toBe('function');
      expect(typeof driver.create).toBe('function');
      expect(typeof driver.start).toBe('function');
      expect(typeof driver.stop).toBe('function');
      expect(typeof driver.destroy).toBe('function');
      expect(typeof driver.execRun).toBe('function');
    });
  });

  describe('LimaRuntimeDriver.list', () => {
    it('maps Lima VMs to RuntimeInfo', async () => {
      const mockVms = [
        { name: 'arig-test', status: 'Running', dir: '/d', arch: 'x86' },
        { name: 'arig-other', status: 'Stopped', dir: '/e', arch: 'arm64' },
      ];
      vi.mocked(limaList).mockResolvedValue(mockVms);

      const driver = createRuntime();
      const result = await driver.list();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'arig-test',
        sandboxName: 'test',
        state: 'running',
        driver: 'lima',
        meta: { dir: '/d', arch: 'x86' },
      });
      expect(result[1]).toEqual({
        name: 'arig-other',
        sandboxName: 'other',
        state: 'stopped',
        driver: 'lima',
        meta: { dir: '/e', arch: 'arm64' },
      });
    });

    it('returns empty array when no VMs', async () => {
      vi.mocked(limaList).mockResolvedValue([]);
      const driver = createRuntime();
      const result = await driver.list();
      expect(result).toEqual([]);
    });

    it('maps Broken status to broken state', async () => {
      vi.mocked(limaList).mockResolvedValue([
        { name: 'arig-bad', status: 'Broken', dir: '/f', arch: 'x86' },
      ]);
      const driver = createRuntime();
      const result = await driver.list();
      expect(result[0].state).toBe('broken');
    });

    it('strips arig- prefix to derive sandboxName', async () => {
      vi.mocked(limaList).mockResolvedValue([
        { name: 'arig-my-project', status: 'Running', dir: '/d', arch: 'x86' },
      ]);
      const driver = createRuntime();
      const result = await driver.list();
      expect(result[0].sandboxName).toBe('my-project');
    });

    it('uses full name as sandboxName when no arig- prefix', async () => {
      vi.mocked(limaList).mockResolvedValue([
        { name: 'other-vm', status: 'Stopped', dir: '/d', arch: 'x86' },
      ]);
      const driver = createRuntime();
      const result = await driver.list();
      expect(result[0].sandboxName).toBe('other-vm');
    });
  });

  describe('LimaRuntimeDriver.inspect', () => {
    it('returns RuntimeInfo for existing sandbox', async () => {
      vi.mocked(limaList).mockResolvedValue([
        { name: 'arig-mysb', status: 'Running', dir: '/d', arch: 'x86' },
      ]);
      const driver = createRuntime();
      const result = await driver.inspect('mysb');
      expect(result).toEqual({
        name: 'arig-mysb',
        sandboxName: 'mysb',
        state: 'running',
        driver: 'lima',
        meta: { dir: '/d', arch: 'x86' },
      });
    });

    it('returns undefined for non-existent sandbox', async () => {
      vi.mocked(limaList).mockResolvedValue([]);
      const driver = createRuntime();
      const result = await driver.inspect('nope');
      expect(result).toBeUndefined();
    });
  });

  describe('LimaRuntimeDriver.execRun', () => {
    it('returns stdout on success', async () => {
      vi.mocked(limaExec).mockResolvedValue('hello');
      const driver = createRuntime();
      const result = await driver.execRun('mysb', ['echo', 'hello']);
      expect(result).toEqual({ stdout: 'hello', stderr: '', exitCode: 0 });
    });

    it('returns error info on failure', async () => {
      vi.mocked(limaExec).mockRejectedValue({
        stdout: '',
        stderr: 'fail',
        exitCode: 1,
      });
      const driver = createRuntime();
      const result = await driver.execRun('mysb', ['bad']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('fail');
    });
  });
});
