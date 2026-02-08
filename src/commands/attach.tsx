import React from 'react';
import { render } from 'ink';
import { sandboxExists } from '../lib/sandbox.js';
import { createRuntime } from '../lib/runtime/index.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function attachCommand(name: string): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const runtime = createRuntime();
  const info = await runtime.inspect(name);

  // Auto-start if stopped
  if (info?.state !== 'running') {
    const { unmount } = render(<Spinner message="Starting sandbox..." />);
    await runtime.start(name);
    // Start Claude Code session
    await runtime.execRun(name, [
      'sudo', '-u', 'agent_dev',
      '/home/agent_dev/bin/start-claude.sh',
    ]);
    unmount();
  }

  // Attach to the primary session via runtime driver
  await runtime.startAttachSession(name);
}
