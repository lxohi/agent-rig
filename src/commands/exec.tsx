import React from 'react';
import { render } from 'ink';
import { sandboxExists } from '../lib/sandbox.js';
import { createRuntime } from '../lib/runtime/index.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function execCommand(name: string, cmd: string[]): Promise<void> {
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
    unmount();
  }

  // Execute command via runtime driver
  const result = await runtime.execRun(name, cmd);

  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
}
