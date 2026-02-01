import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isValidBinary } from './binary.js';

describe('binary', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('isValidBinary', () => {
    it('returns true for executable file', async () => {
      const binPath = join(testDir, 'arig');
      await writeFile(binPath, '#!/bin/bash\necho hello');
      await chmod(binPath, 0o755);
      expect(await isValidBinary(binPath)).toBe(true);
    });

    it('returns false for non-existent file', async () => {
      expect(await isValidBinary(join(testDir, 'nonexistent'))).toBe(false);
    });

    it('returns false for empty file', async () => {
      const binPath = join(testDir, 'empty');
      await writeFile(binPath, '');
      expect(await isValidBinary(binPath)).toBe(false);
    });
  });
});
