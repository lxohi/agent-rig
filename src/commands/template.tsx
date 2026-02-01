import React from 'react';
import { render, Text, Box } from 'ink';
import { loadTemplateIndex, saveTemplateIndex } from '../lib/template.js';
import { limaDelete, getTemplateVMName } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';

export async function templateListCommand(): Promise<void> {
  const index = await loadTemplateIndex();

  if (index.templates.length === 0) {
    render(<Text dimColor>No cached templates. Templates are created when you use packages.</Text>);
    return;
  }

  render(
    <Box flexDirection="column">
      <Box>
        <Box width={20}><Text bold>NAME</Text></Box>
        <Box width={14}><Text bold>HASH</Text></Box>
        <Box width={8}><Text bold>USES</Text></Box>
        <Box><Text bold>PACKAGES</Text></Box>
      </Box>
      {index.templates.map((t) => (
        <Box key={t.hash}>
          <Box width={20}><Text>{t.name}</Text></Box>
          <Box width={14}><Text dimColor>{t.hash}</Text></Box>
          <Box width={8}><Text>{t.usageCount}</Text></Box>
          <Box><Text dimColor>{t.packages.join(', ')}</Text></Box>
        </Box>
      ))}
    </Box>
  );
}

export async function templatePruneCommand(keep: string = '5'): Promise<void> {
  const keepCount = parseInt(keep);
  const index = await loadTemplateIndex();

  if (index.templates.length <= keepCount) {
    render(
      <StatusLine
        status="info"
        message={`Only ${index.templates.length} templates exist. Nothing to prune.`}
      />
    );
    return;
  }

  // Sort by lastUsed, keep most recent
  const sorted = [...index.templates].sort(
    (a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
  );

  const toKeep = sorted.slice(0, keepCount);
  const toDelete = sorted.slice(keepCount);

  // Delete VMs
  for (const template of toDelete) {
    try {
      await limaDelete(getTemplateVMName(template.hash));
    } catch {
      // Ignore if VM doesn't exist
    }
  }

  // Update index
  await saveTemplateIndex({ templates: toKeep });

  render(
    <StatusLine
      status="success"
      message={`Pruned ${toDelete.length} templates. Kept ${toKeep.length}.`}
    />
  );
}
