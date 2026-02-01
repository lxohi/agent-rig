import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computePackageHash,
  loadTemplateIndex,
  saveTemplateIndex,
  findTemplateByHash,
  addTemplate,
} from './template.js';

describe('template', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
    await mkdir(join(testDir, 'templates'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('computePackageHash', () => {
    it('returns consistent hash for same packages', () => {
      const hash1 = computePackageHash(['java-17', 'node-20']);
      const hash2 = computePackageHash(['java-17', 'node-20']);
      expect(hash1).toBe(hash2);
    });

    it('returns same hash regardless of order', () => {
      const hash1 = computePackageHash(['java-17', 'node-20']);
      const hash2 = computePackageHash(['node-20', 'java-17']);
      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different packages', () => {
      const hash1 = computePackageHash(['java-17']);
      const hash2 = computePackageHash(['java-21']);
      expect(hash1).not.toBe(hash2);
    });

    it('returns empty string for empty packages (core template)', () => {
      const hash = computePackageHash([]);
      expect(hash).toBe('');
    });
  });

  describe('loadTemplateIndex', () => {
    it('returns empty index when file does not exist', async () => {
      const index = await loadTemplateIndex(testDir);
      expect(index.templates).toEqual([]);
    });

    it('loads existing index', async () => {
      const indexData = {
        templates: [
          {
            name: 'test-template',
            hash: 'abc123',
            packages: ['java-17'],
            created: '2026-01-01T00:00:00Z',
            lastUsed: '2026-01-01T00:00:00Z',
            usageCount: 1,
          },
        ],
      };
      await writeFile(
        join(testDir, 'templates', 'index.yml'),
        JSON.stringify(indexData)
      );
      const index = await loadTemplateIndex(testDir);
      expect(index.templates).toHaveLength(1);
    });
  });

  describe('findTemplateByHash', () => {
    it('finds template by hash', async () => {
      const index = {
        templates: [
          {
            name: 'test',
            hash: 'abc123',
            packages: ['java-17'],
            created: '2026-01-01T00:00:00Z',
            lastUsed: '2026-01-01T00:00:00Z',
            usageCount: 1,
          },
        ],
      };
      const template = findTemplateByHash(index, 'abc123');
      expect(template?.name).toBe('test');
    });

    it('returns undefined when not found', () => {
      const index = { templates: [] };
      const template = findTemplateByHash(index, 'notfound');
      expect(template).toBeUndefined();
    });
  });

  describe('addTemplate', () => {
    it('adds new template to index', async () => {
      const index = { templates: [] };
      const newIndex = addTemplate(index, {
        name: 'new-template',
        hash: 'xyz789',
        packages: ['node-20'],
        created: '2026-01-01T00:00:00Z',
        lastUsed: '2026-01-01T00:00:00Z',
        usageCount: 1,
      });
      expect(newIndex.templates).toHaveLength(1);
      expect(newIndex.templates[0].name).toBe('new-template');
    });
  });
});
