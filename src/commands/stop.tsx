import React from 'react';
import { render } from 'ink';
import { sandboxExists } from '../lib/sandbox.js';
import { createRuntime } from '../lib/runtime/index.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function stopCommand(name: string): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const runtime = createRuntime();
  const info = await runtime.inspect(name);

  if (info?.state !== 'running') {
    render(<StatusLine status="info" message={`Sandbox "${name}" is already stopped`} />);
    return;
  }

  const { unmount } = render(
    <Spinner message={`Stopping sandbox "${name}"...`} />
  );

  try {
    await runtime.stop(name);
    unmount();
    render(<StatusLine status="success" message={`Stopped sandbox "${name}"`} />);
  } catch (error) {
    unmount();
    render(<StatusLine status="error" message={`Failed to stop: ${error}`} />);
    process.exit(1);
  }
}
