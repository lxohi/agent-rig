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

import { vmExec, vmCopyIn } from './vm-manager.js';
import { computeChecksum, computeVMChecksum, deployBinary } from './binary-deploy.js';
import { createHash } from 'node:crypto';

const TEST_CHECKSUM = createHash('sha256').update('test-binary').digest('hex');

describe('binary-deploy edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeVMChecksum', () => {
    it('handles sha256sum output with extra whitespace', async () => {
      vi.mocked(vmExec).mockResolvedValueOnce({
        stdout: `  ${TEST_CHECKSUM}  /usr/local/bin/arig  \n`,
        stderr: '', exitCode: 0,
      });
      const hash = await computeVMChecksum('/usr/local/bin/arig');
      expect(hash).toBe(TEST_CHECKSUM);
    });
  });

  describe('deployBinary', () => {
    it('skips backup when no existing binary', async () => {
      vi.mocked(vmExec)
        .mockResolvedValueOnce({ stdout: `${TEST_CHECKSUM}  /tmp/arig-deploy-tmp`, stderr: '', exitCode: 0 }) // sha256sum
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 }) // test -f (no existing)
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // mv
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // chmod
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // rm backup

      const result = await deployBinary('/host/arig-linux', TEST_CHECKSUM);
      expect(result.status).toBe('success');

      // Should NOT have called cp for backup (test -f returned exitCode 1)
      const cpCalls = vi.mocked(vmExec).mock.calls.filter(
        c => Array.isArray(c[0]) && c[0].includes('cp'),
      );
      expect(cpCalls).toHaveLength(0);
    });

    it('does not restore backup on replace fail when no prior binary', async () => {
      vi.mocked(vmExec)
        .mockResolvedValueOnce({ stdout: `${TEST_CHECKSUM}  /tmp/arig-deploy-tmp`, stderr: '', exitCode: 0 }) // sha256sum
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 }) // test -f (no existing)
        .mockRejectedValueOnce(new Error('mv failed')); // mv fails

      const result = await deployBinary('/host/arig-linux', TEST_CHECKSUM);
      expect(result.status).toBe('rolled_back');

      // Should NOT have tried to restore backup since there was none
      const mvCalls = vi.mocked(vmExec).mock.calls.filter(
        c => Array.isArray(c[0]) && c[0].includes('mv') && c[0].includes('.bak'),
      );
      expect(mvCalls).toHaveLength(0);
    });

    it('returns rolled_back with descriptive error on checksum mismatch', async () => {
      vi.mocked(vmExec)
        .mockResolvedValueOnce({ stdout: 'deadbeef1234  /tmp/arig-deploy-tmp', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // rm temp

      const result = await deployBinary('/host/arig-linux', TEST_CHECKSUM);
      expect(result.status).toBe('rolled_back');
      expect(result.error).toContain('deadbeef1234');
      expect(result.error).toContain(TEST_CHECKSUM.slice(0, 12));
    });

    it('handles undefined VM checksum (sha256sum fails)', async () => {
      vi.mocked(vmExec)
        .mockResolvedValueOnce({ stdout: '', stderr: 'error', exitCode: 1 }) // sha256sum fails
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }); // rm temp

      const result = await deployBinary('/host/arig-linux', TEST_CHECKSUM);
      expect(result.status).toBe('rolled_back');
      expect(result.error).toContain('none');
    });

    it('computeChecksum reads file and returns hex digest', async () => {
      const hash = await computeChecksum('/any/path');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(hash).toBe(TEST_CHECKSUM);
    });
  });
});
