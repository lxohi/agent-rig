import React from 'react';
import { render } from 'ink';
import { execa } from 'execa';
import { sandboxExists } from '../lib/sandbox.js';
import { limaList, limaStart, getSandboxVMName } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function sshCommand(name: string): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const vmName = getSandboxVMName(name);
  const vms = await limaList();
  const vm = vms.find((v) => v.name === vmName);

  // Auto-start if stopped
  if (vm?.status !== 'Running') {
    const { unmount } = render(<Spinner message="Starting sandbox..." />);
    await limaStart(vmName);
    unmount();
  }

  // SSH as agent_dev
  await execa(
    'limactl',
    ['shell', vmName, '--', 'sudo', '-u', 'agent_dev', '-i'],
    { stdio: 'inherit' }
  );
}
