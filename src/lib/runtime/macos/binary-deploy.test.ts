import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./vm-manager.js', () => ({
  vmExec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  vmCopyIn: vi.fn().mockResolvedValue(undefined),
  VM_BINARY_PATH: '/usr/local/bin/arig',
  restartArigd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('test-binary')),
}));

import { vmExec, vmCopyIn, restartArigd } from './vm-manager.js';
import { computeChecksum, computeVMChecksum, deployBinary } from './binary-deploy.js';
import { createHash } from 'node:crypto';

const TEST_CHECKSUM = createHash('sha256').update('test-binary').digest('hex');

describe('binary-deploy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeChecksum', () => {
    it('computes SHA-256 of a file', async () => {
      const hash = await computeChecksum('/path/to/binary');
      expect(hash).toBe(TEST_CHECKSUM);
    });
  });

  describe('computeVMChecksum', () => {
    it('returns checksum from sha256sum output', async () => {
      vi.mocked(vmExec).mockResolvedValueOnce({
        stdout: `${TEST_CHECKSUM}  /usr/local/bin/arig`,
        stderr: '', exitCode: 0,
      });
      const hash = await computeVMChecksum('/usr/local/bin/arig');
      expect(hash).toBe(TEST_CHECKSUM);
    });

    it('returns undefined when file does not exist', async () => {
      vi.mocked(vmExec).mockResolvedValueOnce({
        stdout: '', stderr: 'No such file', exitCode: 1,
      });
      expect(await computeVMChecksum('/missing')).toBeUndefined();
    });
  });

  describe('deployBinary', () => {
    function mockDeployHappy() {
      // vmCopyIn succeeds (default mock)
      // computeVMChecksum (sha256sum in VM) returns matching checksum
      vi.mocked(vmExec)
        .mockResolvedValueOnce({ stdout: `${TEST_CHECKSUM}  /tmp/arig-deploy-tmp`, stderr: '', exitCode: 0 }) // sha256sum
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // test -f (current exists)
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // cp backup
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // mv atomic replace
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // chmod
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // rm backup
    }

    it('succeeds with matching checksum', async () => {
      mockDeployHappy();
      const result = await deployBinary('/host/arig-linux', TEST_CHECKSUM);
      expect(result.status).toBe('success');
      expect(vmCopyIn).toHaveBeenCalledWith('/host/arig-linux', '/tmp/arig-deploy-tmp');
    });

    it('rolls back on checksum mismatch', async () => {
      // sha256sum returns wrong checksum
      vi.mocked(vmExec)
        .mockResolvedValueOnce({ stdout: 'badhash  /tmp/arig-deploy-tmp', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // rm temp

      const result = await deployBinary('/host/arig-linux', TEST_CHECKSUM);
      expect(result.status).toBe('rolled_back');
      expect(result.error).toContain('Checksum mismatch');
    });

    it('returns failed when upload fails', async () => {
      vi.mocked(vmCopyIn).mockRejectedValueOnce(new Error('SSH connection refused'));
      const result = await deployBinary('/host/arig-linux', TEST_CHECKSUM);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('upload binary');
    });

    it('rolls back when atomic replace fails', async () => {
      vi.mocked(vmExec)
        .mockResolvedValueOnce({ stdout: `${TEST_CHECKSUM}  /tmp/arig-deploy-tmp`, stderr: '', exitCode: 0 }) // sha256sum
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // test -f (exists)
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // cp backup
        .mockRejectedValueOnce(new Error('permission denied')); // mv fails

      const result = await deployBinary('/host/arig-linux', TEST_CHECKSUM);
      expect(result.status).toBe('rolled_back');
      expect(result.error).toContain('replace binary');
    });

    it('still succeeds when arigd restart fails', async () => {
      mockDeployHappy();
      vi.mocked(restartArigd).mockRejectedValueOnce(new Error('service not found'));
      const result = await deployBinary('/host/arig-linux', TEST_CHECKSUM);
      expect(result.status).toBe('success');
    });
  });
});
