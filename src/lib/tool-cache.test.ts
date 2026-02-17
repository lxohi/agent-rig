import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeCacheKey,
  PACKAGE_SCRIPT_HASHES,
  loadToolCacheIndex,
  saveToolCacheIndex,
  findCacheEntry,
  recordCacheHit,
  addCacheEntry,
  checkCache,
  pruneCache,
  type ToolCacheEntry,
  type ToolCacheIndex,
} from './tool-cache.js';

describe('tool-cache', () => {
  describe('PACKAGE_SCRIPT_HASHES', () => {
    it('has entries for all known packages', () => {
      expect(PACKAGE_SCRIPT_HASHES).toHaveProperty('java-17');
      expect(PACKAGE_SCRIPT_HASHES).toHaveProperty('java-21');
      expect(PACKAGE_SCRIPT_HASHES).toHaveProperty('node-20');
      expect(PACKAGE_SCRIPT_HASHES).toHaveProperty('node-22');
      expect(PACKAGE_SCRIPT_HASHES).toHaveProperty('python-312');
      expect(PACKAGE_SCRIPT_HASHES).toHaveProperty('uv');
    });

    it('hashes are 12-char hex strings', () => {
      for (const hash of Object.values(PACKAGE_SCRIPT_HASHES)) {
        expect(hash).toMatch(/^[0-9a-f]{12}$/);
      }
    });

    it('different packages have different hashes', () => {
      const hashes = Object.values(PACKAGE_SCRIPT_HASHES);
      const unique = new Set(hashes);
      expect(unique.size).toBe(hashes.length);
    });
  });

  describe('computeCacheKey', () => {
    it('returns empty string for empty packages', () => {
      const key = computeCacheKey({ packages: [] });
      expect(key).toBe('');
    });

    it('is idempotent for same input', () => {
      const input = { packages: ['node-22'], runtimeVersion: '1.0.0' };
      const key1 = computeCacheKey(input);
      const key2 = computeCacheKey(input);
      expect(key1).toBe(key2);
    });

    it('is order-independent', () => {
      const key1 = computeCacheKey({
        packages: ['java-17', 'node-22'],
        runtimeVersion: '1.0.0',
      });
      const key2 = computeCacheKey({
        packages: ['node-22', 'java-17'],
        runtimeVersion: '1.0.0',
      });
      expect(key1).toBe(key2);
    });

    it('resolves aliases before hashing', () => {
      const key1 = computeCacheKey({
        packages: ['node22'],
        runtimeVersion: '1.0.0',
      });
      const key2 = computeCacheKey({
        packages: ['node-22'],
        runtimeVersion: '1.0.0',
      });
      expect(key1).toBe(key2);
    });

    it('different packages produce different keys', () => {
      const key1 = computeCacheKey({
        packages: ['node-22'],
        runtimeVersion: '1.0.0',
      });
      const key2 = computeCacheKey({
        packages: ['node-20'],
        runtimeVersion: '1.0.0',
      });
      expect(key1).not.toBe(key2);
    });

    it('different runtime versions produce different keys', () => {
      const key1 = computeCacheKey({
        packages: ['node-22'],
        runtimeVersion: '1.0.0',
      });
      const key2 = computeCacheKey({
        packages: ['node-22'],
        runtimeVersion: '2.0.0',
      });
      expect(key1).not.toBe(key2);
    });

    it('returns 12-char hex string', () => {
      const key = computeCacheKey({
        packages: ['node-22'],
        runtimeVersion: '1.0.0',
      });
      expect(key).toMatch(/^[0-9a-f]{12}$/);
    });

    it('uses "unknown" hash for unrecognized packages', () => {
      const key = computeCacheKey({
        packages: ['custom-tool'],
        runtimeVersion: '1.0.0',
      });
      expect(key).toMatch(/^[0-9a-f]{12}$/);
    });

    it('deduplicates aliases before hashing', () => {
      const key1 = computeCacheKey({
        packages: ['py312', 'python-312'],
        runtimeVersion: '1.0.0',
      });
      const key2 = computeCacheKey({
        packages: ['python-312'],
        runtimeVersion: '1.0.0',
      });
      expect(key1).toBe(key2);
    });
  });

  describe('cache index operations', () => {
    const makeEntry = (key: string, tools: string[]): ToolCacheEntry => ({
      key,
      tools,
      runtimeVersion: '0.7.0',
      scriptHashes: {},
      createdAt: '2026-02-08T00:00:00Z',
      lastUsedAt: '2026-02-08T00:00:00Z',
      hitCount: 0,
    });

    it('findCacheEntry returns entry when found', () => {
      const index: ToolCacheIndex = {
        entries: [makeEntry('abc', ['java-17'])],
      };
      const found = findCacheEntry(index, 'abc');
      expect(found).toBeDefined();
      expect(found!.tools).toEqual(['java-17']);
    });

    it('findCacheEntry returns undefined when not found', () => {
      const index: ToolCacheIndex = { entries: [] };
      expect(findCacheEntry(index, 'abc')).toBeUndefined();
    });

    it('recordCacheHit increments hitCount', () => {
      const index: ToolCacheIndex = {
        entries: [makeEntry('abc', ['java-17'])],
      };
      const updated = recordCacheHit(index, 'abc');
      expect(updated.entries[0].hitCount).toBe(1);
      expect(updated.entries[0].lastUsedAt).not.toBe('2026-02-08T00:00:00Z');
    });

    it('addCacheEntry appends to entries', () => {
      const index: ToolCacheIndex = { entries: [] };
      const entry = makeEntry('abc', ['node-22']);
      const updated = addCacheEntry(index, entry);
      expect(updated.entries).toHaveLength(1);
      expect(updated.entries[0].key).toBe('abc');
    });
  });

  describe('checkCache()', () => {
    it('returns entry on cache hit', () => {
      const key = computeCacheKey({ packages: ['node-22'], runtimeVersion: '1.0.0' });
      const index: ToolCacheIndex = {
        entries: [{
          key,
          tools: ['node-22'],
          runtimeVersion: '1.0.0',
          scriptHashes: {},
          createdAt: '2026-02-08T00:00:00Z',
          lastUsedAt: '2026-02-08T00:00:00Z',
          hitCount: 0,
        }],
      };
      const result = checkCache(index, ['node-22'], '1.0.0');
      expect(result).toBeDefined();
      expect(result!.tools).toEqual(['node-22']);
    });

    it('returns undefined on cache miss', () => {
      const index: ToolCacheIndex = { entries: [] };
      expect(checkCache(index, ['node-22'], '1.0.0')).toBeUndefined();
    });
  });

  describe('pruneCache()', () => {
    it('keeps only N most recently used entries', () => {
      const index: ToolCacheIndex = {
        entries: [
          { key: 'a', tools: ['java-17'], runtimeVersion: '0.7.0', scriptHashes: {}, createdAt: '', lastUsedAt: '2026-02-01T00:00:00Z', hitCount: 0 },
          { key: 'b', tools: ['node-22'], runtimeVersion: '0.7.0', scriptHashes: {}, createdAt: '', lastUsedAt: '2026-02-03T00:00:00Z', hitCount: 0 },
          { key: 'c', tools: ['uv'], runtimeVersion: '0.7.0', scriptHashes: {}, createdAt: '', lastUsedAt: '2026-02-02T00:00:00Z', hitCount: 0 },
        ],
      };
      const pruned = pruneCache(index, 2);
      expect(pruned.entries).toHaveLength(2);
      expect(pruned.entries[0].key).toBe('b');
      expect(pruned.entries[1].key).toBe('c');
    });

    it('returns all entries when keep >= count', () => {
      const index: ToolCacheIndex = {
        entries: [
          { key: 'a', tools: ['java-17'], runtimeVersion: '0.7.0', scriptHashes: {}, createdAt: '', lastUsedAt: '2026-02-01T00:00:00Z', hitCount: 0 },
        ],
      };
      const pruned = pruneCache(index, 5);
      expect(pruned.entries).toHaveLength(1);
    });
  });

  describe('persistence (load/save)', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'tool-cache-test-'));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('returns empty index when file does not exist', async () => {
      const index = await loadToolCacheIndex(tempDir);
      expect(index.entries).toEqual([]);
    });

    it('round-trips save and load', async () => {
      const index: ToolCacheIndex = {
        entries: [{
          key: 'test123',
          tools: ['java-17', 'node-22'],
          runtimeVersion: '0.7.0',
          scriptHashes: { 'java-17': 'aaa', 'node-22': 'bbb' },
          createdAt: '2026-02-08T00:00:00Z',
          lastUsedAt: '2026-02-08T01:00:00Z',
          hitCount: 3,
        }],
      };
      await saveToolCacheIndex(index, tempDir);
      const loaded = await loadToolCacheIndex(tempDir);
      expect(loaded.entries).toHaveLength(1);
      expect(loaded.entries[0].key).toBe('test123');
      expect(loaded.entries[0].hitCount).toBe(3);
    });
  });
});
