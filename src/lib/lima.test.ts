import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLimaList, buildLimaConfig } from './lima.js';

describe('lima', () => {
  describe('parseLimaList', () => {
    it('parses lima list NDJSON output with multiple VMs', () => {
      // limactl list --json outputs NDJSON (one JSON object per line)
      const output = [
        JSON.stringify({ name: 'test-vm', status: 'Running', dir: '/path/to/vm', arch: 'aarch64' }),
        JSON.stringify({ name: 'other-vm', status: 'Stopped', dir: '/path/to/other', arch: 'aarch64' }),
      ].join('\n');
      const vms = parseLimaList(output);
      expect(vms).toHaveLength(2);
      expect(vms[0].name).toBe('test-vm');
      expect(vms[0].status).toBe('Running');
    });

    it('parses lima list NDJSON output with single VM', () => {
      const output = JSON.stringify(
        { name: 'single-vm', status: 'Stopped', dir: '/path/to/vm', arch: 'aarch64' }
      );
      const vms = parseLimaList(output);
      expect(vms).toHaveLength(1);
      expect(vms[0].name).toBe('single-vm');
    });

    it('returns empty array for empty output', () => {
      const vms = parseLimaList('');
      expect(vms).toEqual([]);
    });

    it('returns empty array for invalid JSON', () => {
      const vms = parseLimaList('invalid');
      expect(vms).toEqual([]);
    });
  });

  describe('buildLimaConfig', () => {
    it('builds lima config with defaults', () => {
      const config = buildLimaConfig({
        name: 'test-sandbox',
        cpus: 4,
        memory: '8G',
        disk: '30G',
      });
      expect(config.cpus).toBe(4);
      expect(config.memory).toBe('8G');
      expect(config.disk).toBe('30G');
      expect(config.images).toBeDefined();
    });

    it('includes mount configuration', () => {
      const config = buildLimaConfig({
        name: 'test',
        cpus: 2,
        memory: '4G',
        disk: '20G',
      });
      expect(config.mounts).toBeDefined();
    });
  });
});
