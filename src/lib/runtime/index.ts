import type { RuntimeDriver, RuntimeInfo, ExecResult } from './types.js';
import {
  limaList,
  limaStart,
  limaStop,
  limaDelete,
  limaCreate,
  limaExec,
  getSandboxVMName,
  type LimaVM,
} from '../lima.js';
import { LinuxRootlessDriver } from './linux-rootless.js';
import { MacOSSharedVMDriver } from './macos-sharedvm.js';

const LIMA_VM_PREFIX = 'arig-';

function limaVMNameToSandboxName(vmName: string): string {
  return vmName.startsWith(LIMA_VM_PREFIX)
    ? vmName.slice(LIMA_VM_PREFIX.length)
    : vmName;
}

function limaStatusToState(status: LimaVM['status']): RuntimeInfo['state'] {
  switch (status) {
    case 'Running':
      return 'running';
    case 'Stopped':
      return 'stopped';
    case 'Broken':
      return 'broken';
    default:
      return 'unknown';
  }
}

class LimaRuntimeDriver implements RuntimeDriver {
  readonly name = 'lima';

  async list(): Promise<RuntimeInfo[]> {
    const vms = await limaList();
    return vms.map((vm) => ({
      name: vm.name,
      sandboxName: limaVMNameToSandboxName(vm.name),
      state: limaStatusToState(vm.status),
      driver: this.name,
      meta: { dir: vm.dir, arch: vm.arch },
    }));
  }

  async inspect(sandboxName: string): Promise<RuntimeInfo | undefined> {
    const vms = await limaList();
    const vmName = getSandboxVMName(sandboxName);
    const vm = vms.find((v) => v.name === vmName);
    if (!vm) return undefined;
    return {
      name: vm.name,
      sandboxName,
      state: limaStatusToState(vm.status),
      driver: this.name,
      meta: { dir: vm.dir, arch: vm.arch },
    };
  }

  async create(sandboxName: string, opts?: Record<string, unknown>): Promise<void> {
    const vmName = getSandboxVMName(sandboxName);
    const configPath = opts?.configPath as string;
    await limaCreate(vmName, configPath);
  }

  async start(sandboxName: string): Promise<void> {
    const vmName = getSandboxVMName(sandboxName);
    await limaStart(vmName);
  }

  async stop(sandboxName: string): Promise<void> {
    const vmName = getSandboxVMName(sandboxName);
    await limaStop(vmName);
  }

  async destroy(sandboxName: string): Promise<void> {
    const vmName = getSandboxVMName(sandboxName);
    await limaDelete(vmName);
  }

  async execRun(sandboxName: string, command: string[]): Promise<ExecResult> {
    const vmName = getSandboxVMName(sandboxName);
    try {
      const stdout = await limaExec(vmName, command);
      return { stdout, stderr: '', exitCode: 0 };
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; exitCode?: number };
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        exitCode: err.exitCode ?? 1,
      };
    }
  }

  async startExecSession(_sandboxName: string, _command: string[]): Promise<void> {
    throw new Error('startExecSession not yet implemented for Lima driver');
  }

  async startAttachSession(_sandboxName: string): Promise<void> {
    throw new Error('startAttachSession not yet implemented for Lima driver');
  }
}

/** Resolve the appropriate RuntimeDriver for the current platform/config. */
export function createRuntime(opts?: { driver?: string }): RuntimeDriver {
  if (opts?.driver === 'linux-rootless') {
    return new LinuxRootlessDriver();
  }
  if (opts?.driver === 'macos-sharedvm' || opts?.driver === 'macos-sharedvm-rootless') {
    return new MacOSSharedVMDriver();
  }
  // Default: Lima driver (future: auto-detect based on platform)
  return new LimaRuntimeDriver();
}

export type { RuntimeDriver, RuntimeInfo, ExecResult } from './types.js';
export type { SandboxState, SandboxRuntimeState } from './types.js';
export { LinuxRootlessDriver } from './linux-rootless.js';
export { MacOSSharedVMDriver } from './macos-sharedvm.js';
