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
  createVM,
  startVM,
  deleteVM,
  writeVMMarkers,
  isArigdRunning,
  readVMVersion,
  readVMSchema,
  restartArigd,
  vmExec,
} from './vm-manager.js';
import { deployBinary, computeChecksum } from './binary-deploy.js';
import { compareVersions } from '../../version.js';
import { runtimeInit, runtimeStatus, runtimeUpgrade, runtimeRepair } from './bootstrap.js';

describe('bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset defaults
    vi.mocked(isLimaInstalled).mockResolvedValue(true);
    vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'not_found' });
    vi.mocked(isArigdRunning).mockResolvedValue(false);
    vi.mocked(readVMVersion).mockResolvedValue(undefined);
    vi.mocked(readVMSchema).mockResolvedValue(undefined);
    vi.mocked(compareVersions).mockReturnValue(0);
  });

  describe('runtimeInit', () => {
    it('creates and starts VM on first init', async () => {
      await runtimeInit();
      expect(createVM).toHaveBeenCalledWith(expect.objectContaining({
        cpus: 4,
        memory: '4G',
        disk: '30G',
      }));
      expect(startVM).toHaveBeenCalled();
      expect(writeVMMarkers).toHaveBeenCalledWith('0.7.0');
    });

    it('throws when Lima is not installed', async () => {
      vi.mocked(isLimaInstalled).mockResolvedValue(false);
      await expect(runtimeInit()).rejects.toThrow('Lima is not installed');
    });

    it('throws when VM already exists', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'running' });
      await expect(runtimeInit()).rejects.toThrow('already exists');
    });

    it('deploys binary when binaryPath provided', async () => {
      await runtimeInit({ binaryPath: '/host/arig-linux' });
      expect(computeChecksum).toHaveBeenCalledWith('/host/arig-linux');
      expect(deployBinary).toHaveBeenCalledWith('/host/arig-linux', 'abc123');
    });

    it('throws when binary deployment fails', async () => {
      vi.mocked(deployBinary).mockResolvedValueOnce({ status: 'failed', error: 'upload error' });
      await expect(runtimeInit({ binaryPath: '/host/arig' })).rejects.toThrow('Binary deployment failed');
    });

    it('uses custom VM resources', async () => {
      await runtimeInit({ cpus: 8, memory: '8G', disk: '50G' });
      expect(createVM).toHaveBeenCalledWith(expect.objectContaining({
        cpus: 8,
        memory: '8G',
        disk: '50G',
      }));
    });
  });

  describe('runtimeStatus', () => {
    it('returns unavailable when Lima not installed', async () => {
      vi.mocked(isLimaInstalled).mockResolvedValue(false);
      const status = await runtimeStatus();
      expect(status.health).toBe('unavailable');
      expect(status.issues).toContain('Lima is not installed');
    });

    it('returns unavailable when VM not found', async () => {
      const status = await runtimeStatus();
      expect(status.vm).toBe('not_found');
      expect(status.health).toBe('unavailable');
    });

    it('returns unavailable when VM is stopped', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'stopped' });
      const status = await runtimeStatus();
      expect(status.vm).toBe('stopped');
      expect(status.health).toBe('unavailable');
    });

    it('returns healthy when VM running and arigd active', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'running' });
      vi.mocked(isArigdRunning).mockResolvedValue(true);
      vi.mocked(readVMVersion).mockResolvedValue('0.7.0');
      vi.mocked(readVMSchema).mockResolvedValue(1);
      const status = await runtimeStatus();
      expect(status.health).toBe('healthy');
      expect(status.arigd).toBe(true);
      expect(status.issues).toHaveLength(0);
    });

    it('returns degraded when arigd running but version behind', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'running' });
      vi.mocked(isArigdRunning).mockResolvedValue(true);
      vi.mocked(readVMVersion).mockResolvedValue('0.6.0');
      vi.mocked(compareVersions).mockReturnValue(1); // CLI > VM
      const status = await runtimeStatus();
      expect(status.health).toBe('degraded');
      expect(status.issues.some((i) => i.includes('behind'))).toBe(true);
    });

    it('returns unavailable when arigd not running', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'running' });
      vi.mocked(isArigdRunning).mockResolvedValue(false);
      const status = await runtimeStatus();
      expect(status.health).toBe('unavailable');
      expect(status.issues).toContain('arigd.service is not running');
    });
  });

  describe('runtimeUpgrade', () => {
    beforeEach(() => {
      vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'running' });
      vi.mocked(isArigdRunning).mockResolvedValue(true);
      vi.mocked(readVMVersion).mockResolvedValue('0.6.0');
      vi.mocked(readVMSchema).mockResolvedValue(1);
    });

    it('deploys binary and updates markers', async () => {
      await runtimeUpgrade('/host/arig-linux');
      expect(deployBinary).toHaveBeenCalled();
      expect(writeVMMarkers).toHaveBeenCalledWith('0.7.0');
    });

    it('throws when VM not found', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'not_found' });
      vi.mocked(isLimaInstalled).mockResolvedValue(true);
      await expect(runtimeUpgrade('/host/arig')).rejects.toThrow('not found');
    });

    it('starts VM if stopped before upgrading', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'stopped' });
      vi.mocked(isArigdRunning).mockResolvedValue(false);
      await runtimeUpgrade('/host/arig-linux');
      expect(startVM).toHaveBeenCalled();
      expect(deployBinary).toHaveBeenCalled();
    });

    it('throws on checksum rollback', async () => {
      vi.mocked(deployBinary).mockResolvedValueOnce({ status: 'rolled_back', error: 'mismatch' });
      await expect(runtimeUpgrade('/host/arig')).rejects.toThrow('rolled back');
    });

    it('throws when schema is incompatible', async () => {
      vi.mocked(readVMSchema).mockResolvedValue(0); // old schema
      await expect(runtimeUpgrade('/host/arig')).rejects.toThrow('incompatible');
    });
  });

  describe('runtimeRepair', () => {
    it('recreates broken VM', async () => {
      vi.mocked(getVMStatus)
        .mockResolvedValueOnce({ name: 'arig-shared', status: 'broken' }) // repair check
        .mockResolvedValueOnce({ name: 'arig-shared', status: 'not_found' }); // init check
      await runtimeRepair();
      expect(deleteVM).toHaveBeenCalled();
      expect(createVM).toHaveBeenCalled();
    });

    it('runs init when VM not found', async () => {
      vi.mocked(getVMStatus)
        .mockResolvedValueOnce({ name: 'arig-shared', status: 'not_found' }) // repair check
        .mockResolvedValueOnce({ name: 'arig-shared', status: 'not_found' }); // init check
      await runtimeRepair();
      expect(createVM).toHaveBeenCalled();
    });

    it('starts stopped VM and reinstalls components', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'stopped' });
      await runtimeRepair();
      expect(startVM).toHaveBeenCalled();
      expect(restartArigd).toHaveBeenCalled();
      expect(writeVMMarkers).toHaveBeenCalled();
    });

    it('deploys binary during repair when provided', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'running' });
      await runtimeRepair({ binaryPath: '/host/arig-linux' });
      expect(deployBinary).toHaveBeenCalled();
    });

    it('continues when arigd restart fails', async () => {
      vi.mocked(getVMStatus).mockResolvedValue({ name: 'arig-shared', status: 'running' });
      vi.mocked(restartArigd).mockRejectedValueOnce(new Error('service missing'));
      // Should not throw
      await runtimeRepair();
      expect(writeVMMarkers).toHaveBeenCalled();
    });
  });
});
