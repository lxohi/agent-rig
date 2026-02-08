import { execa } from 'execa';
import { logger } from '../../logging.js';

/** Name of the single shared VM used on macOS. */
export const SHARED_VM_NAME = 'arig-shared';

/** Path inside the VM where arigd binary lives. */
export const VM_BINARY_PATH = '/usr/local/bin/arig';

/** Path inside the VM for the version marker. */
export const VM_VERSION_MARKER = '/etc/arig-vm-version';

/** Path inside the VM for the schema marker. */
export const VM_SCHEMA_MARKER = '/etc/arig-vm-schema';

/** Current VM schema version — bump when VM layout changes incompatibly. */
export const VM_SCHEMA_VERSION = 1;

export type VMStatus = 'running' | 'stopped' | 'broken' | 'not_found';

export interface VMInfo {
  name: string;
  status: VMStatus;
  arch?: string;
}

const LOG_COMPONENT = 'vm-manager';

function logFields(event: string) {
  return { component: LOG_COMPONENT, event };
}

/**
 * Check whether limactl is available on the host.
 */
export async function isLimaInstalled(): Promise<boolean> {
  try {
    await execa('limactl', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current status of the shared VM.
 */
export async function getVMStatus(): Promise<VMInfo> {
  try {
    const { stdout } = await execa('limactl', ['list', '--json']);
    if (!stdout.trim()) {
      return { name: SHARED_VM_NAME, status: 'not_found' };
    }

    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      try {
        const vm = JSON.parse(line);
        if (vm.name === SHARED_VM_NAME) {
          const status: VMStatus =
            vm.status === 'Running' ? 'running' :
            vm.status === 'Stopped' ? 'stopped' :
            vm.status === 'Broken' ? 'broken' :
            'not_found';
          return { name: SHARED_VM_NAME, status, arch: vm.arch };
        }
      } catch {
        // skip invalid JSON lines
      }
    }

    return { name: SHARED_VM_NAME, status: 'not_found' };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error('Lima is not installed. Install with: brew install lima');
    }
    throw error;
  }
}

/**
 * Create the shared VM with Ubuntu 24.04.
 */
export async function createVM(opts: {
  cpus: number;
  memory: string;
  disk: string;
  provisionScript?: string;
}): Promise<void> {
  logger.info('Creating shared VM', logFields('vm_create'));

  const config = {
    cpus: opts.cpus,
    memory: opts.memory,
    disk: opts.disk,
    images: [
      {
        location: 'https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img',
        arch: 'x86_64',
      },
      {
        location: 'https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-arm64.img',
        arch: 'aarch64',
      },
    ],
    mounts: [{ location: '/tmp/lima', writable: true }],
    provision: opts.provisionScript
      ? [{ mode: 'system', script: opts.provisionScript }]
      : [],
    ssh: { localPort: 0 },
  };

  // Write config to temp file and create VM
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const tmpDir = await mkdtemp(join(tmpdir(), 'arig-vm-'));
  const configPath = join(tmpDir, 'lima.yaml');

  const { stringify } = await import('yaml');
  await writeFile(configPath, stringify(config), 'utf-8');

  try {
    await execa('limactl', ['create', '--name', SHARED_VM_NAME, configPath]);
    logger.info('Shared VM created', logFields('vm_created'));
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Start the shared VM if it is stopped.
 */
export async function startVM(): Promise<void> {
  logger.info('Starting shared VM', logFields('vm_start'));
  await execa('limactl', ['start', SHARED_VM_NAME]);
  logger.info('Shared VM started', logFields('vm_started'));
}

/**
 * Stop the shared VM.
 */
export async function stopVM(): Promise<void> {
  logger.info('Stopping shared VM', logFields('vm_stop'));
  await execa('limactl', ['stop', SHARED_VM_NAME]);
  logger.info('Shared VM stopped', logFields('vm_stopped'));
}

/**
 * Delete the shared VM entirely.
 */
export async function deleteVM(): Promise<void> {
  logger.info('Deleting shared VM', logFields('vm_delete'));
  await execa('limactl', ['delete', '--force', SHARED_VM_NAME]);
  logger.info('Shared VM deleted', logFields('vm_deleted'));
}

/**
 * Execute a command inside the shared VM via limactl shell.
 */
export async function vmExec(
  command: string[],
  opts?: { reject?: boolean },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execa(
      'limactl',
      ['shell', SHARED_VM_NAME, '--', ...command],
      { reject: opts?.reject ?? true },
    );
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; exitCode?: number };
    if (opts?.reject === false) {
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        exitCode: err.exitCode ?? 1,
      };
    }
    throw error;
  }
}

/**
 * Copy a file from the host into the shared VM.
 * Uses limactl copy which handles SSH transport.
 */
export async function vmCopyIn(
  hostPath: string,
  vmPath: string,
): Promise<void> {
  await execa('limactl', [
    'copy', hostPath, `${SHARED_VM_NAME}:${vmPath}`,
  ]);
}

/**
 * Read the VM version marker. Returns undefined if not set.
 */
export async function readVMVersion(): Promise<string | undefined> {
  const result = await vmExec(['cat', VM_VERSION_MARKER], { reject: false });
  if (result.exitCode !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

/**
 * Read the VM schema version. Returns undefined if not set.
 */
export async function readVMSchema(): Promise<number | undefined> {
  const result = await vmExec(['cat', VM_SCHEMA_MARKER], { reject: false });
  if (result.exitCode !== 0) return undefined;
  const val = parseInt(result.stdout.trim(), 10);
  return Number.isNaN(val) ? undefined : val;
}

/**
 * Write version and schema markers inside the VM.
 */
export async function writeVMMarkers(version: string): Promise<void> {
  await vmExec(['sudo', 'tee', VM_VERSION_MARKER], { reject: false });
  // Use shell to write content
  await vmExec([
    'sudo', 'bash', '-c',
    `echo '${version}' > ${VM_VERSION_MARKER} && echo '${VM_SCHEMA_VERSION}' > ${VM_SCHEMA_MARKER}`,
  ]);
  logger.info(`VM markers written: version=${version}, schema=${VM_SCHEMA_VERSION}`, logFields('vm_markers_written'));
}

/**
 * Check if arigd.service is active inside the VM.
 */
export async function isArigdRunning(): Promise<boolean> {
  const result = await vmExec(
    ['systemctl', 'is-active', 'arigd.service'],
    { reject: false },
  );
  return result.stdout.trim() === 'active';
}

/**
 * Restart arigd.service inside the VM.
 */
export async function restartArigd(): Promise<void> {
  logger.info('Restarting arigd.service', logFields('arigd_restart'));
  await vmExec(['sudo', 'systemctl', 'restart', 'arigd.service']);
  logger.info('arigd.service restarted', logFields('arigd_restarted'));
}
