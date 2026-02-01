import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { PresetsFile } from './types.js';
import { getConfigDir } from './config.js';

export const DEFAULT_PRESETS: PresetsFile = {
  presets: {
    'fullstack-dev': {
      description: 'Full stack development with Java and Node',
      packages: ['java-17', 'node-20'],
    },
    'python-ml': {
      description: 'Python machine learning development',
      packages: ['python-312', 'uv'],
    },
    frontend: {
      description: 'Frontend development',
      packages: ['node-20'],
    },
  },
};

export async function loadPresets(configDir?: string): Promise<PresetsFile> {
  const dir = configDir || getConfigDir();
  const presetsPath = join(dir, 'presets.yml');

  try {
    const content = await readFile(presetsPath, 'utf-8');
    const parsed = parseYaml(content) as PresetsFile;
    return {
      presets: {
        ...DEFAULT_PRESETS.presets,
        ...parsed.presets,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_PRESETS;
    }
    throw error;
  }
}

export function getPreset(presets: PresetsFile, name: string): string[] | undefined {
  return presets.presets[name]?.packages;
}
