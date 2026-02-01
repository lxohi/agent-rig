import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { TemplateIndex, TemplateEntry } from './types.js';
import { getConfigDir } from './config.js';

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
