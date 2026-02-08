import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { TemplateIndex, TemplateEntry } from './types.js';
import { getConfigDir } from './config.js';
import { computeCacheKey } from './tool-cache.js';
import { VERSION } from '../version.js';

export function computePackageHash(packages: string[]): string {
  if (packages.length === 0) return '';
  const sorted = [...packages].sort();
  return createHash('sha256').update(sorted.join(',')).digest('hex').slice(0, 12);
}

export async function loadTemplateIndex(configDir?: string): Promise<TemplateIndex> {
  const dir = configDir || getConfigDir();
  const indexPath = join(dir, 'templates', 'index.yml');

  try {
    const content = await readFile(indexPath, 'utf-8');
    return parseYaml(content) as TemplateIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { templates: [] };
    }
    throw error;
  }
}

export async function saveTemplateIndex(
  index: TemplateIndex,
  configDir?: string
): Promise<void> {
  const dir = configDir || getConfigDir();
  const templatesDir = join(dir, 'templates');
  await mkdir(templatesDir, { recursive: true });
  const indexPath = join(templatesDir, 'index.yml');
  await writeFile(indexPath, stringifyYaml(index));
}

export function findTemplateByHash(
  index: TemplateIndex,
  hash: string
): TemplateEntry | undefined {
  return index.templates.find((t) => t.hash === hash);
}

export function addTemplate(
  index: TemplateIndex,
  entry: TemplateEntry
): TemplateIndex {
  return {
    templates: [...index.templates, entry],
  };
}

export function updateTemplateUsage(
  index: TemplateIndex,
  hash: string
): TemplateIndex {
  return {
    templates: index.templates.map((t) =>
      t.hash === hash
        ? { ...t, lastUsed: new Date().toISOString(), usageCount: t.usageCount + 1 }
        : t
    ),
  };
}

/**
 * Compute a v2 cache key for packages using script hashes + runtime version.
 * Falls back to v1 (package-name-only) hash when called with no version override.
 */
export function computePackageHashV2(packages: string[]): string {
  return computeCacheKey({ packages });
}

/**
 * Check if a cached template is stale.
 * A template is stale when:
 * - Its scriptHash doesn't match the current computed cache key
 * - Its runtimeVersion doesn't match the current CLI version
 * - It has no scriptHash (v1 template, needs rebuild)
 */
export function isTemplateStale(entry: TemplateEntry): boolean {
  if (!entry.scriptHash) return true;
  const currentKey = computeCacheKey({ packages: entry.packages });
  if (entry.scriptHash !== currentKey) return true;
  if (entry.runtimeVersion && entry.runtimeVersion !== VERSION) return true;
  return false;
}

/**
 * Find a valid (non-stale) template for the given packages.
 * Returns undefined if no matching template exists or all matches are stale.
 */
export function findValidTemplate(
  index: TemplateIndex,
  packages: string[]
): TemplateEntry | undefined {
  const cacheKey = computeCacheKey({ packages });
  if (!cacheKey) return undefined;
  return index.templates.find(
    (t) => t.scriptHash === cacheKey && t.runtimeVersion === VERSION
  );
}

/**
 * Remove stale templates from the index.
 * Returns the cleaned index and the list of removed entries.
 */
export function removeStaleTemplates(
  index: TemplateIndex
): { index: TemplateIndex; removed: TemplateEntry[] } {
  const removed: TemplateEntry[] = [];
  const kept: TemplateEntry[] = [];
  for (const t of index.templates) {
    if (isTemplateStale(t)) {
      removed.push(t);
    } else {
      kept.push(t);
    }
  }
  return { index: { templates: kept }, removed };
}
