import { render } from 'ink';
import React from 'react';
import { runtimeInit, runtimeStatus, runtimeUpgrade, runtimeRepair } from '../lib/runtime/macos/bootstrap.js';

// Lazy import UI components to avoid circular deps in tests
async function getUI() {
  const { Spinner } = await import('../components/Spinner.js');
  const { StatusLine } = await import('../components/StatusLine.js');
  return { Spinner, StatusLine };
}

export async function runtimeInitCommand(opts: {
  cpus?: string;
  memory?: string;
  disk?: string;
  binary?: string;
}): Promise<void> {
  const { Spinner, StatusLine } = await getUI();
  const { unmount } = render(React.createElement(Spinner, { message: 'Initializing shared VM...' }));

  try {
    await runtimeInit({
      cpus: opts.cpus ? parseInt(opts.cpus, 10) : undefined,
      memory: opts.memory,
      disk: opts.disk,
      binaryPath: opts.binary,
    });
    unmount();
    render(React.createElement(StatusLine, { status: 'success', message: 'Shared VM initialized' }));
  } catch (error) {
    unmount();
    render(React.createElement(StatusLine, {
      status: 'error',
      message: (error as Error).message,
    }));
    process.exit(1);
  }
}

export async function runtimeStatusCommand(): Promise<void> {
  const status = await runtimeStatus();

  console.log(`VM:      ${status.vm}`);
  console.log(`arigd:   ${status.arigd ? 'running' : 'stopped'}`);
  console.log(`Version: ${status.version ?? 'unknown'}`);
  console.log(`Schema:  ${status.schema ?? 'unknown'}`);
  console.log(`Health:  ${status.health}`);

  if (status.issues.length > 0) {
    console.log('\nIssues:');
    for (const issue of status.issues) {
      console.log(`  - ${issue}`);
    }
  }
}

export async function runtimeUpgradeCommand(opts: {
  binary: string;
}): Promise<void> {
  const { Spinner, StatusLine } = await getUI();
  const { unmount } = render(React.createElement(Spinner, { message: 'Upgrading runtime...' }));

  try {
    await runtimeUpgrade(opts.binary);
    unmount();
    render(React.createElement(StatusLine, { status: 'success', message: 'Runtime upgraded' }));
  } catch (error) {
    unmount();
    render(React.createElement(StatusLine, {
      status: 'error',
      message: (error as Error).message,
    }));
    process.exit(1);
  }
}

export async function runtimeRepairCommand(opts: {
  binary?: string;
}): Promise<void> {
  const { Spinner, StatusLine } = await getUI();
  const { unmount } = render(React.createElement(Spinner, { message: 'Repairing runtime...' }));

  try {
    await runtimeRepair({ binaryPath: opts.binary });
    unmount();
    render(React.createElement(StatusLine, { status: 'success', message: 'Runtime repaired' }));
  } catch (error) {
    unmount();
    render(React.createElement(StatusLine, {
      status: 'error',
      message: (error as Error).message,
    }));
    process.exit(1);
  }
}
