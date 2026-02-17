import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { VERSION } from '../version.js';
import { resolveAliases } from './tool-aliases.js';
import { getConfigDir } from './config.js';

/**
 * Embedded package script hashes.
 * These are SHA-256 hashes of each package's install.sh content.
 * Updated when package scripts change (triggers cache invalidation).
 */
export const PACKAGE_SCRIPT_HASHES: Record<string, string> = {
  'java-17': hashContent(
    'mise use --global java@temurin-17\nmise use --global gradle@8.5\nmise use --global maven@3.9.6',
  ),
  'java-21': hashContent(
    'mise use --global java@temurin-21\nmise use --global gradle@8.5\nmise use --global maven@3.9.6',
  ),
  'node-20': hashContent('mise use --global node@20'),
  'node-22': hashContent('mise use --global node@22'),
  'python-312': hashContent('mise use --global python@3.12'),
  'uv': hashContent('mise use --global uv'),
};

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

export interface CacheKeyInput {
  packages: string[];
  runtimeVersion?: string;
}

/**
 * Compute a v2 cache key that incorporates:
 * 1. Sorted canonical package names (after alias resolution)
 * 2. Script hashes for each package (detects install script changes)
 * 3. Runtime version (detects CLI upgrades)
 *
 * Returns empty string for empty packages (core template).
 */
export function computeCacheKey(input: CacheKeyInput): string {
  const resolved = resolveAliases(input.packages);
  if (resolved.length === 0) return '';

  const sorted = [...resolved].sort();
  const version = input.runtimeVersion ?? VERSION;

  // Build composite key: "pkg1:hash1,pkg2:hash2|version"
  const parts = sorted.map((pkg) => {
    const scriptHash = PACKAGE_SCRIPT_HASHES[pkg] ?? 'unknown';
    return `${pkg}:${scriptHash}`;
  });

  const composite = `${parts.join(',')}|${version}`;
  return createHash('sha256').update(composite).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Cache index persistence
// ---------------------------------------------------------------------------

export interface ToolCacheEntry {
  key: string;
  tools: string[];
  runtimeVersion: string;
  scriptHashes: Record<string, string>;
  createdAt: string;
  lastUsedAt: string;
  hitCount: number;
}

export interface ToolCacheIndex {
  entries: ToolCacheEntry[];
}

export async function loadToolCacheIndex(configDir?: string): Promise<ToolCacheIndex> {
  const dir = configDir || getConfigDir();
  const indexPath = join(dir, 'tool-cache', 'index.yml');
  try {
    const content = await readFile(indexPath, 'utf-8');
    return parseYaml(content) as ToolCacheIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: [] };
    }
    throw error;
  }
}

export async function saveToolCacheIndex(
  index: ToolCacheIndex,
  configDir?: string,
): Promise<void> {
  const dir = configDir || getConfigDir();
  const cacheDir = join(dir, 'tool-cache');
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, 'index.yml'), stringifyYaml(index));
}

export function findCacheEntry(
  index: ToolCacheIndex,
  key: string,
): ToolCacheEntry | undefined {
  return index.entries.find((e) => e.key === key);
}

export function recordCacheHit(
  index: ToolCacheIndex,
  key: string,
): ToolCacheIndex {
  return {
    entries: index.entries.map((e) =>
      e.key === key
        ? { ...e, lastUsedAt: new Date().toISOString(), hitCount: e.hitCount + 1 }
        : e,
    ),
  };
}

export function addCacheEntry(
  index: ToolCacheIndex,
  entry: ToolCacheEntry,
): ToolCacheIndex {
  return { entries: [...index.entries, entry] };
}

/**
 * Check whether a tool combination is cached and still valid.
 */
export function checkCache(
  index: ToolCacheIndex,
  packages: string[],
  runtimeVersion?: string,
): ToolCacheEntry | undefined {
  const key = computeCacheKey({ packages, runtimeVersion });
  return findCacheEntry(index, key);
}

/**
 * Prune old cache entries, keeping only the N most recently used.
 */
export function pruneCache(
  index: ToolCacheIndex,
  keep: number,
): ToolCacheIndex {
  const sorted = [...index.entries].sort(
    (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
  );
  return { entries: sorted.slice(0, keep) };
}
