import React from 'react';
import { render } from 'ink';
import { sandboxExists } from '../lib/sandbox.js';
import { limaStop, limaList, getSandboxVMName } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function stopCommand(name: string): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const vmName = getSandboxVMName(name);
  const vms = await limaList();
  const vm = vms.find((v) => v.name === vmName);

  if (vm?.status !== 'Running') {
    render(<StatusLine status="info" message={`Sandbox "${name}" is already stopped`} />);
    return;
  }

  const { unmount } = render(
    <Spinner message={`Stopping sandbox "${name}"...`} />
  );

  try {
    await limaStop(vmName);
    unmount();
    render(<StatusLine status="success" message={`Stopped sandbox "${name}"`} />);
  } catch (error) {
    unmount();
    render(<StatusLine status="error" message={`Failed to stop: ${error}`} />);
    process.exit(1);
  }
}
