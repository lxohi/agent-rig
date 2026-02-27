import { platform } from 'node:os';
import type { RuntimeDriver, RuntimeInfo, ExecResult } from './types.js';
import { LinuxRootlessDriver } from './linux-rootless.js';
import { MacOSSharedVMDriver } from './macos-sharedvm.js';

/** Resolve the appropriate RuntimeDriver for the current platform/config. */
export function createRuntime(opts?: { driver?: string }): RuntimeDriver {
  const driver = opts?.driver;
  if (driver === 'linux-rootless') {
    return new LinuxRootlessDriver();
  }
  if (driver === 'macos-sharedvm' || driver === 'macos-sharedvm-rootless') {
    return new MacOSSharedVMDriver();
  }
  if (driver) {
    throw new Error(
      `Unknown runtime driver "${driver}".\n` +
      'Available drivers: linux-rootless (Linux), macos-sharedvm (macOS)'
    );
  }
  // Auto-detect based on platform
  if (platform() === 'darwin') {
    return new MacOSSharedVMDriver();
  }
  return new LinuxRootlessDriver();
}

export type { RuntimeDriver, RuntimeInfo, ExecResult } from './types.js';
export type { SandboxState, SandboxRuntimeState } from './types.js';
export { LinuxRootlessDriver } from './linux-rootless.js';
export { MacOSSharedVMDriver } from './macos-sharedvm.js';
