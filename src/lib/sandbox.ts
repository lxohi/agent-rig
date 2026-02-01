import { readFile, writeFile, mkdir, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { SandboxConfig } from './types.js';
import { getConfigDir } from './config.js';

export async function saveSandboxConfig(
  config: SandboxConfig,
  configDir?: string
): Promise<void> {
  const dir = configDir || getConfigDir();
  const sandboxDir = join(dir, 'sandboxes', config.name);
  await mkdir(sandboxDir, { recursive: true });
  await writeFile(join(sandboxDir, 'config.yml'), stringifyYaml(config));
}

export async function loadSandboxConfig(
  name: string,
  configDir?: string
): Promise<SandboxConfig> {
  const dir = configDir || getConfigDir();
  const configPath = join(dir, 'sandboxes', name, 'config.yml');
  const content = await readFile(configPath, 'utf-8');
  return parseYaml(content) as SandboxConfig;
}

export async function listSandboxes(configDir?: string): Promise<string[]> {
  const dir = configDir || getConfigDir();
  const sandboxesDir = join(dir, 'sandboxes');

  try {
    const entries = await readdir(sandboxesDir, { withFileTypes: true });
    const sandboxes: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          await access(join(sandboxesDir, entry.name, 'config.yml'));
          sandboxes.push(entry.name);
        } catch {
          // No config.yml, skip
        }
      }
    }

    return sandboxes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function deleteSandboxConfig(
  name: string,
  configDir?: string
): Promise<void> {
  const dir = configDir || getConfigDir();
  const sandboxDir = join(dir, 'sandboxes', name);
  await rm(sandboxDir, { recursive: true, force: true });
}

export async function sandboxExists(
  name: string,
  configDir?: string
): Promise<boolean> {
  const dir = configDir || getConfigDir();
  try {
    await access(join(dir, 'sandboxes', name, 'config.yml'));
    return true;
  } catch {
    return false;
  }
}
