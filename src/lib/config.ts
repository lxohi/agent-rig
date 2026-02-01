import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import type { Config } from './types.js';

export const DEFAULT_CONFIG: Config = {
  vm: {
    cpus: 4,
    memory: '8G',
    disk: '30G',
  },
  claude: {
    base_url: '',
    auth_token: '',
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

export function getConfigDir(): string {
  return process.env.ARIG_CONFIG_DIR || join(homedir(), '.agent-rig');
}

export async function loadConfig(configDir?: string): Promise<Config> {
  const dir = configDir || getConfigDir();
  const configPath = join(dir, 'config.yml');

  try {
    const content = await readFile(configPath, 'utf-8');
    const parsed = parseYaml(content) as Partial<Config>;
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_CONFIG;
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
