import React from 'react';
import { render } from 'ink';
import { StatusLine } from '../components/StatusLine.js';
import { sandboxExists, loadSandboxConfig } from '../lib/sandbox.js';
import { createRuntime } from '../lib/runtime/index.js';
import {
  addPortMapping,
  removePortMapping,
  listPortMappings,
} from '../lib/ports.js';

export async function portAddCommand(
  sandboxName: string,
  opts: {
    host: string;
    target: string;
    public?: boolean;
    bind?: string;
  },
): Promise<void> {
  if (!(await sandboxExists(sandboxName))) {
    render(<StatusLine status="error" message={`Sandbox "${sandboxName}" not found`} />);
    process.exit(1);
  }

  const hostPort = parseInt(opts.host, 10);
  const targetPort = parseInt(opts.target, 10);

  if (isNaN(hostPort) || isNaN(targetPort)) {
    render(<StatusLine status="error" message="--host and --target must be numbers" />);
    process.exit(1);
  }

  const bindAddress = opts.public ? '0.0.0.0' : (opts.bind ?? '127.0.0.1');

  // Check if sandbox is running
  const runtime = createRuntime();
  const info = await runtime.inspect(sandboxName);
  const isRunning = info?.state === 'running';

  try {
    const mapping = await addPortMapping(sandboxName, hostPort, targetPort, {
      bindAddress,
      sandboxRunning: isRunning,
      sandboxUid: info?.meta?.uid as number | undefined,
      sandboxUsername: info?.meta?.username as string | undefined,
    });

    const statusMsg = mapping.status === 'active'
      ? `Port ${bindAddress}:${hostPort} -> ${targetPort} active`
      : `Port ${bindAddress}:${hostPort} -> ${targetPort} pending (will activate on start)`;

    render(<StatusLine status="success" message={statusMsg} />);
  } catch (error) {
    render(<StatusLine status="error" message={`${error}`} />);
    process.exit(1);
  }
}

export async function portRemoveCommand(
  sandboxName: string,
  opts: { host: string },
): Promise<void> {
  if (!(await sandboxExists(sandboxName))) {
    render(<StatusLine status="error" message={`Sandbox "${sandboxName}" not found`} />);
    process.exit(1);
  }

  const hostPort = parseInt(opts.host, 10);
  if (isNaN(hostPort)) {
    render(<StatusLine status="error" message="--host must be a number" />);
    process.exit(1);
  }

  const runtime = createRuntime();
  const info = await runtime.inspect(sandboxName);
  const isRunning = info?.state === 'running';

  try {
    await removePortMapping(sandboxName, hostPort, { sandboxRunning: isRunning });
    render(<StatusLine status="success" message={`Port ${hostPort} removed`} />);
  } catch (error) {
    render(<StatusLine status="error" message={`${error}`} />);
    process.exit(1);
  }
}

export async function portListCommand(sandboxName: string): Promise<void> {
  if (!(await sandboxExists(sandboxName))) {
    render(<StatusLine status="error" message={`Sandbox "${sandboxName}" not found`} />);
    process.exit(1);
  }

  const mappings = await listPortMappings(sandboxName);

  if (mappings.length === 0) {
    console.log('No port mappings configured.');
    return;
  }

  console.log('PORT MAPPINGS:');
  console.log('');
  console.log(
    'ID'.padEnd(16) +
    'HOST'.padEnd(24) +
    'TARGET'.padEnd(10) +
    'PROTO'.padEnd(8) +
    'STATUS'.padEnd(10),
  );
  console.log('-'.repeat(68));

  for (const m of mappings) {
    const host = `${m.bindAddress}:${m.hostPort}`;
    console.log(
      m.id.padEnd(16) +
      host.padEnd(24) +
      String(m.targetPort).padEnd(10) +
      m.protocol.padEnd(8) +
      m.status.padEnd(10) +
      (m.lastError ? `(${m.lastError})` : ''),
    );
  }
}
