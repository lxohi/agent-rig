import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, cpus, totalmem } from 'node:os';
import { parse as parseYaml } from 'yaml';
import type { Config } from './types.js';

/**
 * Calculate dynamic VM defaults based on host system resources
 * - CPUs: 1/4 of host CPUs, min 2, max 4
 * - Memory: 1/8 of host RAM, min 2G, max 8G
 */
function getSystemBasedDefaults(): { cpus: number; memory: string } {
  // CPU: 1/4 of host, min 2, max 4
  const hostCpus = cpus().length;
  const vmCpus = Math.min(4, Math.max(2, Math.floor(hostCpus / 4)));

  // Memory: 1/8 of host RAM in GB, min 2, max 8
  const hostMemGB = Math.floor(totalmem() / (1024 * 1024 * 1024));
  const vmMemGB = Math.min(8, Math.max(2, Math.floor(hostMemGB / 8)));

  return {
    cpus: vmCpus,
    memory: `${vmMemGB}G`,
  };
}

export function getDefaultConfig(): Config {
  const systemDefaults = getSystemBasedDefaults();

  return {
    vm: {
      cpus: systemDefaults.cpus,
      memory: systemDefaults.memory,
      disk: '30G',
    },
    claude: {
      baseUrl: '',
      authToken: '',
    },
    limits: {
      memory_max: '16G',
      cpu_quota: '400%',
      tasks_max: 1024,
    },
    git: {
      user: '',
      email: '',
    },
  };
}

// For backwards compatibility
export const DEFAULT_CONFIG: Config = getDefaultConfig();

export function getConfigDir(): string {
  return process.env.ARIG_CONFIG_DIR || join(homedir(), '.agent-rig');
}

export async function loadConfig(configDir?: string): Promise<Config> {
  const dir = configDir || getConfigDir();
  const configPath = join(dir, 'config.yml');
  const defaultConfig = getDefaultConfig();

  try {
    const content = await readFile(configPath, 'utf-8');
    const parsed = parseYaml(content) as Partial<Config>;
    return deepMerge(defaultConfig, parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultConfig;
    }
    throw error;
  }
}

function deepMerge(target: Config, source: Partial<Config>): Config {
  return {
    vm: { ...target.vm, ...source.vm },
    claude: { ...target.claude, ...source.claude },
    limits: { ...target.limits, ...source.limits },
    git: { ...target.git, ...source.git },
  };
}
