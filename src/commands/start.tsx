import React from 'react';
import { render } from 'ink';
import { sandboxExists } from '../lib/sandbox.js';
import { limaStart, limaList, getSandboxVMName, limaExec } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function startCommand(name: string): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const vmName = getSandboxVMName(name);
  const vms = await limaList();
  const vm = vms.find((v) => v.name === vmName);

  if (vm?.status === 'Running') {
    render(<StatusLine status="info" message={`Sandbox "${name}" is already running`} />);
    return;
  }

  const { unmount } = render(
    <Spinner message={`Starting sandbox "${name}"...`} />
  );

  try {
    await limaStart(vmName);
    // Start Claude Code session
    await limaExec(vmName, [
      'sudo',
      '-u',
      'agent_dev',
      '/home/agent_dev/bin/start-claude.sh',
    ]);
    unmount();
    render(<StatusLine status="success" message={`Started sandbox "${name}"`} />);
  } catch (error) {
    unmount();
    render(<StatusLine status="error" message={`Failed to start: ${error}`} />);
    process.exit(1);
  }
}
