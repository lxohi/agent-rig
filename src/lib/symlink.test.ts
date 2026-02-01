import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { swapSymlink, getCurrentVersion } from './symlink.js';

describe('symlink', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
    await mkdir(join(testDir, 'bin'), { recursive: true });
    await mkdir(join(testDir, 'versions', '0.1.0'), { recursive: true });
    await mkdir(join(testDir, 'versions', '0.2.0'), { recursive: true });
    await writeFile(join(testDir, 'versions', '0.1.0', 'arig'), '#!/bin/bash\necho v0.1.0');
    await writeFile(join(testDir, 'versions', '0.2.0', 'arig'), '#!/bin/bash\necho v0.2.0');
    await symlink('../versions/0.1.0/arig', join(testDir, 'bin', 'arig'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('swapSymlink', () => {
    it('updates symlink to new version', async () => {
      await swapSymlink('0.2.0', testDir);
      const target = await readlink(join(testDir, 'bin', 'arig'));
      expect(target).toContain('0.2.0');
    });
  });

  describe('getCurrentVersion', () => {
    it('reads version from symlink target', async () => {
      const version = await getCurrentVersion(testDir);
      expect(version).toBe('0.1.0');
    });
  });
});
