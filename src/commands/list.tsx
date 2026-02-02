import React from 'react';
import { render, Text, Box } from 'ink';
import { listSandboxes, loadSandboxConfig } from '../lib/sandbox.js';
import { limaList, getSandboxVMName } from '../lib/lima.js';
import type { SandboxConfig } from '../lib/types.js';

interface SandboxInfo {
  config: SandboxConfig;
  status: 'running' | 'stopped' | 'unknown';
}

function ListOutput({ sandboxes }: { sandboxes: SandboxInfo[] }) {
  if (sandboxes.length === 0) {
    return <Text dimColor>No sandboxes found. Create one with: arig create &lt;name&gt;</Text>;
  }

  // Calculate dynamic column widths
  const nameWidth = Math.max(
    4, // "NAME"
    ...sandboxes.map((sb) => sb.config.name.length)
  ) + 2;
  const statusWidth = 12;
  const repoWidth = Math.max(
    4, // "REPO"
    ...sandboxes.map((sb) => sb.config.repo.length)
  ) + 2;

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={nameWidth}><Text bold>NAME</Text></Box>
        <Box width={statusWidth}><Text bold>STATUS</Text></Box>
        <Box width={repoWidth}><Text bold>REPO</Text></Box>
        <Box><Text bold>PACKAGES</Text></Box>
      </Box>
      {sandboxes.map((sb) => (
        <Box key={sb.config.name}>
          <Box width={nameWidth}><Text>{sb.config.name}</Text></Box>
          <Box width={statusWidth}>
            <Text color={sb.status === 'running' ? 'green' : 'red'}>
              {sb.status}
            </Text>
          </Box>
          <Box width={repoWidth}><Text dimColor>{sb.config.repo}</Text></Box>
          <Box><Text dimColor>{sb.config.packages.join(', ')}</Text></Box>
        </Box>
      ))}
    </Box>
  );
}

export async function listCommand(): Promise<void> {
  const sandboxNames = await listSandboxes();
  const vms = await limaList();

  const sandboxes: SandboxInfo[] = await Promise.all(
    sandboxNames.map(async (name) => {
      const config = await loadSandboxConfig(name);
      const vmName = getSandboxVMName(name);
      const vm = vms.find((v) => v.name === vmName);
      const status = vm?.status === 'Running' ? 'running' : 'stopped';
      return { config, status };
    })
  );

  render(<ListOutput sandboxes={sandboxes} />);
}
