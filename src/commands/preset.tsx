import React from 'react';
import { render, Text, Box } from 'ink';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadPresets, DEFAULT_PRESETS } from '../lib/presets.js';
import { getConfigDir } from '../lib/config.js';
import { StatusLine } from '../components/StatusLine.js';
import type { PresetsFile } from '../lib/types.js';

export async function presetListCommand(): Promise<void> {
  const presets = await loadPresets();

  render(
    <Box flexDirection="column">
      <Box>
        <Box width={20}><Text bold>NAME</Text></Box>
        <Box width={40}><Text bold>DESCRIPTION</Text></Box>
        <Box><Text bold>PACKAGES</Text></Box>
      </Box>
      {Object.entries(presets.presets).map(([name, preset]) => (
        <Box key={name}>
          <Box width={20}><Text>{name}</Text></Box>
          <Box width={40}><Text dimColor>{preset.description}</Text></Box>
          <Box><Text dimColor>{preset.packages.join(', ')}</Text></Box>
        </Box>
      ))}
    </Box>
  );
}

export async function presetCreateCommand(
  name: string,
  packages: string
): Promise<void> {
  const configDir = getConfigDir();
  const presetsPath = join(configDir, 'presets.yml');

  // Load existing user presets
  let userPresets: PresetsFile = { presets: {} };
  try {
    const content = await readFile(presetsPath, 'utf-8');
    userPresets = parseYaml(content) as PresetsFile;
  } catch {
    // File doesn't exist, start fresh
  }

  // Check if preset already exists
  if (userPresets.presets[name] || DEFAULT_PRESETS.presets[name]) {
    render(
      <StatusLine status="error" message={`Preset "${name}" already exists`} />
    );
    process.exit(1);
  }

  // Add new preset
  userPresets.presets[name] = {
    description: `Custom preset: ${packages}`,
    packages: packages.split(',').map((p) => p.trim()),
  };

  // Save
  await mkdir(configDir, { recursive: true });
  await writeFile(presetsPath, stringifyYaml(userPresets));

  render(
    <StatusLine status="success" message={`Created preset "${name}"`} />
  );
}

export async function presetDeleteCommand(name: string): Promise<void> {
  // Can't delete default presets
  if (DEFAULT_PRESETS.presets[name]) {
    render(
      <StatusLine status="error" message={`Cannot delete built-in preset "${name}"`} />
    );
    process.exit(1);
  }

  const configDir = getConfigDir();
  const presetsPath = join(configDir, 'presets.yml');

  let userPresets: PresetsFile;
  try {
    const content = await readFile(presetsPath, 'utf-8');
    userPresets = parseYaml(content) as PresetsFile;
  } catch {
    render(
      <StatusLine status="error" message={`Preset "${name}" not found`} />
    );
    process.exit(1);
  }

  if (!userPresets.presets[name]) {
    render(
      <StatusLine status="error" message={`Preset "${name}" not found`} />
    );
    process.exit(1);
  }

  delete userPresets.presets[name];
  await writeFile(presetsPath, stringifyYaml(userPresets));

  render(
    <StatusLine status="success" message={`Deleted preset "${name}"`} />
  );
}
