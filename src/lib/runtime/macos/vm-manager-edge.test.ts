import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

vi.mock('../../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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

import { execa } from 'execa';
import {
  SHARED_VM_NAME,
  VM_SCHEMA_VERSION,
  getVMStatus,
  vmExec,
  readVMVersion,
  readVMSchema,
  writeVMMarkers,
  createVM,
} from './vm-manager.js';

describe('vm-manager edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getVMStatus', () => {
    it('handles multi-line JSON output (multiple VMs)', async () => {
      const lines = [
        JSON.stringify({ name: 'other-vm', status: 'Running' }),
        JSON.stringify({ name: SHARED_VM_NAME, status: 'Stopped' }),
      ].join('\n');
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: lines, stderr: '', exitCode: 0,
      } as any);

      const info = await getVMStatus();
      expect(info.status).toBe('stopped');
    });

    it('skips blank lines in JSON output', async () => {
      const lines = [
        '',
        JSON.stringify({ name: SHARED_VM_NAME, status: 'Running' }),
        '',
      ].join('\n');
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: lines, stderr: '', exitCode: 0,
      } as any);

      const info = await getVMStatus();
      expect(info.status).toBe('running');
    });

    it('skips invalid JSON lines gracefully', async () => {
      const lines = [
        'not-json-at-all',
        JSON.stringify({ name: SHARED_VM_NAME, status: 'Running' }),
      ].join('\n');
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: lines, stderr: '', exitCode: 0,
      } as any);

      const info = await getVMStatus();
      expect(info.status).toBe('running');
    });

    it('maps unknown Lima status to not_found', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: JSON.stringify({ name: SHARED_VM_NAME, status: 'Unknown' }),
        stderr: '', exitCode: 0,
      } as any);

      const info = await getVMStatus();
      expect(info.status).toBe('not_found');
    });

    it('propagates non-ENOENT errors', async () => {
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      vi.mocked(execa).mockRejectedValueOnce(err);

      await expect(getVMStatus()).rejects.toThrow('permission denied');
    });

    it('returns not_found for whitespace-only stdout', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '   \n  \n  ', stderr: '', exitCode: 0,
      } as any);

      const info = await getVMStatus();
      expect(info.status).toBe('not_found');
    });
  });

  describe('vmExec', () => {
    it('throws by default when command fails (reject=true)', async () => {
      vi.mocked(execa).mockRejectedValueOnce(new Error('command failed'));
      await expect(vmExec(['bad-cmd'])).rejects.toThrow('command failed');
    });

    it('returns defaults for missing fields when reject=false', async () => {
      vi.mocked(execa).mockRejectedValueOnce({});
      const result = await vmExec(['cmd'], { reject: false });
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(1);
    });

    it('returns exitCode 0 when result.exitCode is undefined', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'ok', stderr: '', exitCode: undefined,
      } as any);
      const result = await vmExec(['cmd']);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('readVMVersion', () => {
    it('returns undefined for empty string after trim', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '  \n  ', stderr: '', exitCode: 0,
      } as any);
      expect(await readVMVersion()).toBeUndefined();
    });
  });

  describe('readVMSchema', () => {
    it('returns undefined when vmExec fails', async () => {
      vi.mocked(execa).mockRejectedValueOnce({
        stdout: '', stderr: 'error', exitCode: 1,
      });
      expect(await readVMSchema()).toBeUndefined();
    });

    it('returns undefined for empty string', async () => {
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: '', stderr: '', exitCode: 0,
      } as any);
      expect(await readVMSchema()).toBeUndefined();
    });
  });

  describe('createVM', () => {
    it('cleans up temp dir even when limactl create fails', async () => {
      const { rm } = await import('node:fs/promises');
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('create failed'));

      await expect(createVM({
        cpus: 2, memory: '2G', disk: '10G',
      })).rejects.toThrow('create failed');

      expect(rm).toHaveBeenCalled();
    });

    it('passes provision script when provided', async () => {
      await createVM({
        cpus: 2, memory: '2G', disk: '10G',
        provisionScript: '#!/bin/bash\necho hello',
      });

      const { stringify } = await import('yaml');
      expect(stringify).toHaveBeenCalled();
      const configArg = vi.mocked(stringify).mock.calls[0][0] as any;
      expect(configArg.provision).toHaveLength(1);
      expect(configArg.provision[0].mode).toBe('system');
    });

    it('passes empty provision array when no script', async () => {
      await createVM({ cpus: 2, memory: '2G', disk: '10G' });

      const { stringify } = await import('yaml');
      const configArg = vi.mocked(stringify).mock.calls[0][0] as any;
      expect(configArg.provision).toHaveLength(0);
    });
  });

  describe('writeVMMarkers', () => {
    it('writes version and schema via vmExec', async () => {
      await writeVMMarkers('1.2.3');
      // Should call vmExec once (bash -c to write both markers)
      expect(execa).toHaveBeenCalledTimes(1);
      const calls = vi.mocked(execa).mock.calls;
      const bashCall = calls.find(c =>
        Array.isArray(c[1]) && c[1].includes('bash'),
      );
      expect(bashCall).toBeDefined();
      const bashArgs = bashCall![1] as string[];
      const script = bashArgs[bashArgs.length - 1];
      expect(script).toContain('1.2.3');
      expect(script).toContain(String(VM_SCHEMA_VERSION));
    });
  });
});
