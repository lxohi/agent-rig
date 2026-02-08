import React from 'react';
import { render } from 'ink';
import { sandboxExists, deleteSandboxConfig } from '../lib/sandbox.js';
import { createRuntime } from '../lib/runtime/index.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function destroyCommand(name: string): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const { unmount } = render(
    <Spinner message={`Destroying sandbox "${name}"...`} />
  );

  try {
    const runtime = createRuntime();
    await runtime.destroy(name);
    await deleteSandboxConfig(name);
    unmount();
    render(<StatusLine status="success" message={`Destroyed sandbox "${name}"`} />);
  } catch (error) {
    unmount();
    render(<StatusLine status="error" message={`Failed to destroy: ${error}`} />);
    process.exit(1);
  }
}
