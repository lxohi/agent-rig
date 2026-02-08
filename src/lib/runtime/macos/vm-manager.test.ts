import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SHARED_VM_NAME,
  VM_BINARY_PATH,
  VM_VERSION_MARKER,
  VM_SCHEMA_MARKER,
  VM_SCHEMA_VERSION,
} from './vm-manager.js';

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

vi.mock('../../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execa } from 'execa';

import {
  isLimaInstalled,
  getVMStatus,
  createVM,
  startVM,
  stopVM,
  deleteVM,
  vmExec,
  vmCopyIn,
  readVMVersion,
  readVMSchema,
  writeVMMarkers,
  isArigdRunning,
  restartArigd,
} from './vm-manager.js';

// Mock fs/yaml for createVM
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue('/tmp/arig-vm-test'),
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('binary')),
  access: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('yaml', () => ({
  stringify: vi.fn().mockReturnValue('yaml-content'),
}));

describe('vm-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constants', () => {
    it('exports expected VM name', () => {
      expect(SHARED_VM_NAME).toBe('arig-shared');
    });

    it('exports expected binary path', () => {
      expect(VM_BINARY_PATH).toBe('/usr/local/bin/arig');
    });

    it('exports schema version as number', () => {
      expect(typeof VM_SCHEMA_VERSION).toBe('number');
      expect(VM_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isLimaInstalled', () => {
    it('returns true when limactl is available', async () => {
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '0.20.0', stderr: '', exitCode: 0 } as any);
      expect(await isLimaInstalled()).toBe(true);
    });

    it('returns false when limactl is not found', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('ENOENT'));
      expect(await isLimaInstalled()).toBe(false);
    });
  });

  describe('getVMStatus', () => {
    it('returns not_found when no VMs exist', async () => {
      vi.mocked(execa).mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      const info = await getVMStatus();
      expect(info.status).toBe('not_found');
    });

    it('returns running when shared VM is Running', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: JSON.stringify({ name: SHARED_VM_NAME, status: 'Running', arch: 'aarch64' }),
        stderr: '', exitCode: 0,
      } as any);
      const info = await getVMStatus();
      expect(info.status).toBe('running');
      expect(info.arch).toBe('aarch64');
    });

    it('returns stopped when shared VM is Stopped', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: JSON.stringify({ name: SHARED_VM_NAME, status: 'Stopped' }),
        stderr: '', exitCode: 0,
      } as any);
      const info = await getVMStatus();
      expect(info.status).toBe('stopped');
    });

    it('returns broken when shared VM is Broken', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: JSON.stringify({ name: SHARED_VM_NAME, status: 'Broken' }),
        stderr: '', exitCode: 0,
      } as any);
      const info = await getVMStatus();
      expect(info.status).toBe('broken');
    });

    it('returns not_found when only other VMs exist', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: JSON.stringify({ name: 'other-vm', status: 'Running' }),
        stderr: '', exitCode: 0,
      } as any);
      const info = await getVMStatus();
      expect(info.status).toBe('not_found');
    });

    it('throws when Lima is not installed', async () => {
      const err = new Error('not found') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      vi.mocked(execa).mockRejectedValueOnce(err);
      await expect(getVMStatus()).rejects.toThrow('Lima is not installed');
    });
  });

  describe('startVM', () => {
    it('calls limactl start with shared VM name', async () => {
      await startVM();
      expect(execa).toHaveBeenCalledWith('limactl', ['start', SHARED_VM_NAME]);
    });
  });

  describe('stopVM', () => {
    it('calls limactl stop with shared VM name', async () => {
      await stopVM();
      expect(execa).toHaveBeenCalledWith('limactl', ['stop', SHARED_VM_NAME]);
    });
  });

  describe('deleteVM', () => {
    it('calls limactl delete --force', async () => {
      await deleteVM();
      expect(execa).toHaveBeenCalledWith('limactl', ['delete', '--force', SHARED_VM_NAME]);
    });
  });

  describe('vmExec', () => {
    it('executes command via limactl shell', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'hello', stderr: '', exitCode: 0,
      } as any);
      const result = await vmExec(['echo', 'hello']);
      expect(execa).toHaveBeenCalledWith(
        'limactl',
        ['shell', SHARED_VM_NAME, '--', 'echo', 'hello'],
        { reject: true },
      );
      expect(result.stdout).toBe('hello');
    });

    it('returns error info when reject=false', async () => {
      vi.mocked(execa).mockRejectedValueOnce({
        stdout: '', stderr: 'fail', exitCode: 1,
      });
      const result = await vmExec(['bad-cmd'], { reject: false });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('fail');
    });
  });

  describe('vmCopyIn', () => {
    it('calls limactl copy with correct args', async () => {
      await vmCopyIn('/host/file', '/vm/path');
      expect(execa).toHaveBeenCalledWith('limactl', [
        'copy', '/host/file', `${SHARED_VM_NAME}:/vm/path`,
      ]);
    });
  });

  describe('readVMVersion', () => {
    it('returns version string when marker exists', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '0.7.0\n', stderr: '', exitCode: 0,
      } as any);
      expect(await readVMVersion()).toBe('0.7.0');
    });

    it('returns undefined when marker does not exist', async () => {
      vi.mocked(execa).mockRejectedValueOnce({
        stdout: '', stderr: 'No such file', exitCode: 1,
      });
      expect(await readVMVersion()).toBeUndefined();
    });
  });

  describe('readVMSchema', () => {
    it('returns schema number when marker exists', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '1\n', stderr: '', exitCode: 0,
      } as any);
      expect(await readVMSchema()).toBe(1);
    });

    it('returns undefined for non-numeric content', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'invalid', stderr: '', exitCode: 0,
      } as any);
      expect(await readVMSchema()).toBeUndefined();
    });
  });

  describe('isArigdRunning', () => {
    it('returns true when service is active', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'active', stderr: '', exitCode: 0,
      } as any);
      expect(await isArigdRunning()).toBe(true);
    });

    it('returns false when service is inactive', async () => {
      vi.mocked(execa).mockRejectedValueOnce({
        stdout: 'inactive', stderr: '', exitCode: 3,
      });
      expect(await isArigdRunning()).toBe(false);
    });
  });

  describe('restartArigd', () => {
    it('calls systemctl restart via vmExec', async () => {
      await restartArigd();
      expect(execa).toHaveBeenCalledWith(
        'limactl',
        ['shell', SHARED_VM_NAME, '--', 'sudo', 'systemctl', 'restart', 'arigd.service'],
        { reject: true },
      );
    });
  });
});
