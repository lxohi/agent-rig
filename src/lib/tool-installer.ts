import { resolveAliases, KNOWN_PACKAGES } from './tool-aliases.js';
import {
  computeCacheKey,
  PACKAGE_SCRIPT_HASHES,
  loadToolCacheIndex,
  saveToolCacheIndex,
  findCacheEntry,
  recordCacheHit,
  addCacheEntry,
  type ToolCacheEntry,
} from './tool-cache.js';
import { VERSION } from '../version.js';
import { logger } from './logging.js';

export interface InstallResult {
  /** Whether tools were installed fresh or reused from cache. */
  cached: boolean;
  /** The cache key for this tool combination. */
  cacheKey: string;
  /** Canonical tool names that were resolved. */
  tools: string[];
}

/**
 * Validate that all requested packages are known.
 * Throws if any package is unrecognized (after alias resolution).
 */
export function validatePackages(packages: string[]): string[] {
  const resolved = resolveAliases(packages);
  const unknown = resolved.filter((p) => !KNOWN_PACKAGES.includes(p));
  if (unknown.length > 0) {
    throw new Error(`Unknown packages: ${unknown.join(', ')}`);
  }
  return resolved;
}

/**
 * Check for conflicting packages (e.g. java-17 + java-21).
 * Returns an array of conflict descriptions, empty if none.
 */
export function detectConflicts(packages: string[]): string[] {
  const conflicts: string[] = [];
  const javaVersions = packages.filter((p) => p.startsWith('java-'));
  if (javaVersions.length > 1) {
    conflicts.push(`Conflicting Java versions: ${javaVersions.join(', ')}`);
  }
  return conflicts;
}
