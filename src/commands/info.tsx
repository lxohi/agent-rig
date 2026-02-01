import React from 'react';
import { render, Text, Box } from 'ink';
import { loadSandboxConfig, sandboxExists } from '../lib/sandbox.js';
import { limaList, getSandboxVMName } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';

function InfoOutput({
  config,
  status,
}: {
  config: {
    name: string;
    repo: string;
    branch: string;
    packages: string[];
    vm: { cpus: number; memory: string; disk: string };
    created: string;
  };
  status: string;
}) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Sandbox:</Text> {config.name}
      </Text>
      <Text>
        <Text bold>Status:</Text>{' '}
        <Text color={status === 'running' ? 'green' : 'red'}>{status}</Text>
      </Text>
      <Text>
        <Text bold>Created:</Text> {config.created}
      </Text>
      <Text />
      <Text>
        <Text bold>Repository:</Text> {config.repo}
      </Text>
      <Text>
        <Text bold>Branch:</Text> {config.branch}
      </Text>
      <Text />
      <Text bold>Packages:</Text>
      {config.packages.length === 0 ? (
        <Text dimColor>  (none)</Text>
      ) : (
        config.packages.map((pkg) => (
          <Text key={pkg}>  • {pkg}</Text>
        ))
      )}
      <Text />
      <Text bold>Resources:</Text>
      <Text>  CPUs:   {config.vm.cpus}</Text>
      <Text>  Memory: {config.vm.memory}</Text>
      <Text>  Disk:   {config.vm.disk}</Text>
    </Box>
  );
}

export async function infoCommand(name: string): Promise<void> {
  const exists = await sandboxExists(name);
  if (!exists) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const config = await loadSandboxConfig(name);
  const vms = await limaList();
  const vmName = getSandboxVMName(name);
  const vm = vms.find((v) => v.name === vmName);
  const status = vm?.status === 'Running' ? 'running' : 'stopped';

  render(<InfoOutput config={config} status={status} />);
}
