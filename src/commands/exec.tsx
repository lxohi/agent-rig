import React from 'react';
import { render } from 'ink';
import { execa } from 'execa';
import { sandboxExists } from '../lib/sandbox.js';
import { limaList, limaStart, getSandboxVMName } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function execCommand(name: string, cmd: string[]): Promise<void> {
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

  // Execute command as agent_dev
  const { stdout, stderr } = await execa(
    'limactl',
    ['shell', vmName, '--', 'sudo', '-u', 'agent_dev', 'bash', '-c', cmd.join(' ')],
    { reject: false }
  );

  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}
