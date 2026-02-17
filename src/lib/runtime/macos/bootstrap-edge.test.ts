import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./vm-manager.js', () => ({
  SHARED_VM_NAME: 'arig-shared',
  VM_SCHEMA_VERSION: 1,
  isLimaInstalled: vi.fn().mockResolvedValue(true),
  getVMStatus: vi.fn().mockResolvedValue({ name: 'arig-shared', status: 'not_found' }),
  createVM: vi.fn().mockResolvedValue(undefined),
  startVM: vi.fn().mockResolvedValue(undefined),
  stopVM: vi.fn().mockResolvedValue(undefined),
  deleteVM: vi.fn().mockResolvedValue(undefined),
  vmExec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  readVMVersion: vi.fn().mockResolvedValue(undefined),
  readVMSchema: vi.fn().mockResolvedValue(undefined),
  writeVMMarkers: vi.fn().mockResolvedValue(undefined),
  isArigdRunning: vi.fn().mockResolvedValue(false),
  restartArigd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./binary-deploy.js', () => ({
  deployBinary: vi.fn().mockResolvedValue({ status: 'success' }),
  computeChecksum: vi.fn().mockResolvedValue('abc123'),
}));

vi.mock('../../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../version.js', () => ({
  VERSION: '0.7.0',
}));

vi.mock('../../version.js', () => ({
  compareVersions: vi.fn().mockReturnValue(0),
}));

vi.mock('../../root-helper-script.js', () => ({
  ROOT_HELPER_SCRIPT: '#!/bin/bash\necho helper',
}));

vi.mock('../../sudoers-template.js', () => ({
  SUDOERS_TEMPLATE: '# sudoers',
  ROOT_HELPER_PATH: '/usr/local/libexec/arigd-root-helper',
  SUDOERS_DROP_IN_PATH: '/etc/sudoers.d/arigd-root-helper',
  ARIG_GROUP: 'arig',
}));

import {
  isLimaInstalled,
  getVMStatus,
  startVM,
  writeVMMarkers,
  isArigdRunning,
  readVMVersion,
  readVMSchema,
  vmExec,
} from './vm-manager.js';
import { deployBinary } from './binary-deploy.js';
import { compareVersions } from '../../version.js';
import { runtimeInit, runtimeStatus, runtimeUpgrade, runtimeRepair } from './bootstrap.js';

describe('bootstrap edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isLimaInstalled).mockResolvedValue(true);
    vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'not_found' });
    vi.mocked(isArigdRunning).mockResolvedValue(false);
    vi.mocked(readVMVersion).mockResolvedValue(undefined);
    vi.mocked(readVMSchema).mockResolvedValue(undefined);
    vi.mocked(compareVersions).mockReturnValue(0);
  });

  describe('runtimeInit', () => {
    it('throws when deploy returns rolled_back', async () => {
      vi.mocked(deployBinary).mockResolvedValueOnce({
        status: 'rolled_back',
        error: 'checksum mismatch',
      });
      await expect(
        runtimeInit({ binaryPath: '/host/arig' }),
      ).rejects.toThrow('Binary deployment failed');
    });

    it('skips binary deploy when no binaryPath', async () => {
      await runtimeInit();
      expect(deployBinary).not.toHaveBeenCalled();
    });

    it('throws when VM is stopped (already exists)', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({
        name: 'arig-shared', status: 'stopped',
      });
      await expect(runtimeInit()).rejects.toThrow('already exists');
    });
  });

  describe('runtimeStatus', () => {
    it('reports missing version marker as issue', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({
        name: 'arig-shared', status: 'running',
      });
      vi.mocked(isArigdRunning).mockResolvedValue(true);
      vi.mocked(readVMVersion).mockResolvedValue(undefined);
      vi.mocked(readVMSchema).mockResolvedValue(1);

      const status = await runtimeStatus();
      expect(status.issues).toContain('VM version marker missing');
      expect(status.health).toBe('degraded');
    });

    it('reports outdated schema as issue', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({
        name: 'arig-shared', status: 'running',
      });
      vi.mocked(isArigdRunning).mockResolvedValue(true);
      vi.mocked(readVMVersion).mockResolvedValue('0.7.0');
      vi.mocked(readVMSchema).mockResolvedValue(0);

      const status = await runtimeStatus();
      expect(status.issues.some(i => i.includes('schema'))).toBe(true);
      expect(status.health).toBe('degraded');
    });

    it('returns broken VM status as unavailable', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({
        name: 'arig-shared', status: 'broken',
      });
      const status = await runtimeStatus();
      expect(status.vm).toBe('broken');
      expect(status.health).toBe('unavailable');
    });

    it('returns version and schema in status', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({
        name: 'arig-shared', status: 'running',
      });
      vi.mocked(isArigdRunning).mockResolvedValue(true);
      vi.mocked(readVMVersion).mockResolvedValue('0.7.0');
      vi.mocked(readVMSchema).mockResolvedValue(1);

      const status = await runtimeStatus();
      expect(status.version).toBe('0.7.0');
      expect(status.schema).toBe(1);
    });
  });

  describe('runtimeUpgrade', () => {
    beforeEach(() => {
      vi.mocked(getVMStatus).mockResolvedValue({
        name: 'arig-shared', status: 'running',
      });
      vi.mocked(isArigdRunning).mockResolvedValue(true);
      vi.mocked(readVMVersion).mockResolvedValue('0.6.0');
      vi.mocked(readVMSchema).mockResolvedValue(1);
    });

    it('throws when deploy returns failed', async () => {
      vi.mocked(deployBinary).mockResolvedValueOnce({
        status: 'failed',
        error: 'upload error',
      });
      await expect(
        runtimeUpgrade('/host/arig'),
      ).rejects.toThrow('Upgrade failed');
    });

    it('updates markers after successful deploy', async () => {
      await runtimeUpgrade('/host/arig-linux');
      expect(writeVMMarkers).toHaveBeenCalledWith('0.7.0');
    });
  });

  describe('runtimeRepair', () => {
    it('throws when Lima is not installed', async () => {
      vi.mocked(isLimaInstalled).mockResolvedValue(false);
      await expect(runtimeRepair()).rejects.toThrow('Lima is not installed');
    });

    it('continues when binary re-deploy fails during repair', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({
        name: 'arig-shared', status: 'running',
      });
      vi.mocked(deployBinary).mockResolvedValueOnce({
        status: 'failed',
        error: 'upload error',
      });
      // Should not throw — repair logs warning and continues
      await runtimeRepair({ binaryPath: '/host/arig' });
      expect(writeVMMarkers).toHaveBeenCalled();
    });

    it('validates sudoers and removes invalid file', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({
        name: 'arig-shared', status: 'running',
      });
      // Mock vmExec to fail on visudo validation
      let callCount = 0;
      vi.mocked(vmExec).mockImplementation(async (cmd: string[]) => {
        callCount++;
        if (cmd.includes('visudo')) {
          return { stdout: '', stderr: 'syntax error', exitCode: 1 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      // installRootHelperInVM will throw on sudoers validation failure
      await expect(runtimeRepair()).rejects.toThrow('Sudoers validation failed');
    });
  });
});
