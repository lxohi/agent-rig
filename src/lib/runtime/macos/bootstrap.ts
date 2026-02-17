import { logger } from '../../logging.js';
import { VERSION } from '../../../version.js';
import { compareVersions } from '../../version.js';
import {
  SHARED_VM_NAME,
  VM_SCHEMA_VERSION,
  isLimaInstalled,
  getVMStatus,
  createVM,
  startVM,
  stopVM,
  deleteVM,
  vmExec,
  readVMVersion,
  readVMSchema,
  writeVMMarkers,
  isArigdRunning,
  restartArigd,
} from './vm-manager.js';
import { deployBinary, computeChecksum } from './binary-deploy.js';

const LOG_COMPONENT = 'bootstrap';

function logFields(event: string) {
  return { component: LOG_COMPONENT, event };
}

export type HealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface RuntimeStatus {
  vm: 'running' | 'stopped' | 'broken' | 'not_found';
  arigd: boolean;
  version?: string;
  schema?: number;
  health: HealthStatus;
  issues: string[];
}

/** Embedded provision script for the shared VM. */
const VM_PROVISION_SCRIPT = `#!/bin/bash
set -e

echo "=== Installing base packages ==="
apt-get update
apt-get install -y \\
  apt-transport-https ca-certificates curl gnupg \\
  git tmux jq htop vim unzip wget \\
  build-essential uidmap dbus-user-session \\
  apparmor apparmor-utils

echo "=== Installing Docker ==="
curl -fsSL https://get.docker.com | sh

echo "=== Shared VM provisioning complete ==="
`;

/**
 * `arig runtime init` — First-time shared VM initialization.
 *
 * 1. Verify Lima is installed
 * 2. Create shared VM (Ubuntu 24.04) if not exists
 * 3. Start VM
 * 4. Deploy arigd binary
 * 5. Install root helper + sudoers inside VM
 * 6. Write version/schema markers
 */
export async function runtimeInit(opts?: {
  cpus?: number;
  memory?: string;
  disk?: string;
  binaryPath?: string;
}): Promise<void> {
  logger.info('Starting runtime init', logFields('init_start'));

  // 1. Verify Lima
  if (!(await isLimaInstalled())) {
    throw new Error('Lima is not installed. Install with: brew install lima');
  }

  // 2. Check if VM already exists
  const vmInfo = await getVMStatus();
  if (vmInfo.status !== 'not_found') {
    throw new Error(
      `Shared VM "${SHARED_VM_NAME}" already exists (status: ${vmInfo.status}). ` +
      'Use "arig runtime upgrade" to update or "arig runtime repair" to fix.',
    );
  }

  // 3. Create VM
  await createVM({
    cpus: opts?.cpus ?? 4,
    memory: opts?.memory ?? '4G',
    disk: opts?.disk ?? '30G',
    provisionScript: VM_PROVISION_SCRIPT,
  });

  // 4. Start VM
  await startVM();

  // 5. Deploy binary if path provided
  if (opts?.binaryPath) {
    const checksum = await computeChecksum(opts.binaryPath);
    const result = await deployBinary(opts.binaryPath, checksum);
    if (result.status !== 'success') {
      throw new Error(`Binary deployment failed: ${result.error}`);
    }
  }

  // 6. Install root helper inside VM
  await installRootHelperInVM();

  // 7. Write version/schema markers
  await writeVMMarkers(VERSION);

  logger.info('Runtime init complete', logFields('init_complete'));
}

/**
 * `arig runtime status` — Health check for the shared VM.
 *
 * Checks: VM exists + running, arigd responsive, version compat.
 */
export async function runtimeStatus(): Promise<RuntimeStatus> {
  const issues: string[] = [];

  // Check Lima
  if (!(await isLimaInstalled())) {
    return {
      vm: 'not_found',
      arigd: false,
      health: 'unavailable',
      issues: ['Lima is not installed'],
    };
  }

  // Check VM
  const vmInfo = await getVMStatus();
  if (vmInfo.status === 'not_found') {
    return {
      vm: 'not_found',
      arigd: false,
      health: 'unavailable',
      issues: ['Shared VM not found. Run "arig runtime init".'],
    };
  }

  if (vmInfo.status !== 'running') {
    return {
      vm: vmInfo.status,
      arigd: false,
      health: 'unavailable',
      issues: [`Shared VM is ${vmInfo.status}. Run "arig runtime repair".`],
    };
  }

  // VM is running — check arigd
  const arigdActive = await isArigdRunning();
  if (!arigdActive) {
    issues.push('arigd.service is not running');
  }

  // Check version
  const vmVersion = await readVMVersion();
  const vmSchema = await readVMSchema();

  if (!vmVersion) {
    issues.push('VM version marker missing');
  } else if (compareVersions(VERSION, vmVersion) > 0) {
    issues.push(`VM version ${vmVersion} is behind CLI ${VERSION}. Run "arig runtime upgrade".`);
  }

  if (vmSchema !== undefined && vmSchema < VM_SCHEMA_VERSION) {
    issues.push(`VM schema ${vmSchema} is outdated (current: ${VM_SCHEMA_VERSION}). Run "arig runtime upgrade".`);
  }

  // PLACEHOLDER_STATUS_CONTINUE

  const health: HealthStatus =
    issues.length === 0 ? 'healthy' :
    arigdActive ? 'degraded' :
    'unavailable';

  return {
    vm: 'running',
    arigd: arigdActive,
    version: vmVersion,
    schema: vmSchema,
    health,
    issues,
  };
}

/**
 * `arig runtime upgrade` — Push new binary, atomic replace, restart arigd.
 *
 * CLI N is backward-compatible with daemon N-1.
 * Incompatible schema changes require repair.
 */
export async function runtimeUpgrade(binaryPath: string): Promise<void> {
  logger.info('Starting runtime upgrade', logFields('upgrade_start'));

  const status = await runtimeStatus();
  if (status.vm === 'not_found') {
    throw new Error('Shared VM not found. Run "arig runtime init" first.');
  }

  // Start VM if stopped
  if (status.vm === 'stopped') {
    await startVM();
  }

  // Check schema compatibility
  if (status.schema !== undefined && status.schema < VM_SCHEMA_VERSION) {
    logger.warn(
      `VM schema ${status.schema} requires repair before upgrade`,
      logFields('upgrade_schema_mismatch'),
    );
    throw new Error(
      `VM schema version ${status.schema} is incompatible with current ${VM_SCHEMA_VERSION}. ` +
      'Run "arig runtime repair" first.',
    );
  }

  // Deploy new binary
  const checksum = await computeChecksum(binaryPath);
  const result = await deployBinary(binaryPath, checksum);

  if (result.status === 'rolled_back') {
    throw new Error(`Upgrade rolled back: ${result.error}`);
  }
  if (result.status === 'failed') {
    throw new Error(`Upgrade failed: ${result.error}`);
  }

  // Update version marker
  await writeVMMarkers(VERSION);

  logger.info('Runtime upgrade complete', logFields('upgrade_complete'));
}

/**
 * `arig runtime repair` — Rebuild arigd components, preserve sandbox configs.
 *
 * Steps:
 * 1. Ensure VM exists and is running (start if stopped, recreate if broken)
 * 2. Re-install root helper + sudoers
 * 3. Verify/restart arigd.service
 * 4. Resource rescan (reconcile)
 * 5. Update markers
 */
export async function runtimeRepair(opts?: {
  binaryPath?: string;
}): Promise<void> {
  logger.info('Starting runtime repair', logFields('repair_start'));

  if (!(await isLimaInstalled())) {
    throw new Error('Lima is not installed. Install with: brew install lima');
  }

  const vmInfo = await getVMStatus();

  // Handle broken VM — delete and recreate
  if (vmInfo.status === 'broken') {
    logger.warn('VM is broken, deleting and recreating', logFields('repair_recreate'));
    await deleteVM();
    await runtimeInit({ binaryPath: opts?.binaryPath });
    return;
  }

  // Handle missing VM
  if (vmInfo.status === 'not_found') {
    logger.warn('VM not found, running init', logFields('repair_init'));
    await runtimeInit({ binaryPath: opts?.binaryPath });
    return;
  }

  // Start if stopped
  if (vmInfo.status === 'stopped') {
    await startVM();
  }

  // Re-deploy binary if provided
  if (opts?.binaryPath) {
    const checksum = await computeChecksum(opts.binaryPath);
    const result = await deployBinary(opts.binaryPath, checksum);
    if (result.status !== 'success') {
      logger.warn(`Binary re-deploy during repair: ${result.status}`, {
        ...logFields('repair_deploy'),
        error: result.error,
      });
    }
  }

  // Re-install root helper
  await installRootHelperInVM();

  // Restart arigd
  try {
    await restartArigd();
  } catch (error) {
    logger.warn('arigd restart failed during repair', {
      ...logFields('repair_arigd_restart'),
      error: (error as Error).message,
    });
  }

  // Update markers
  await writeVMMarkers(VERSION);

  logger.info('Runtime repair complete', logFields('repair_complete'));
}

/**
 * Install the root helper script and sudoers drop-in inside the shared VM.
 * Mirrors what `arig setup` does on Linux, but executed inside the VM.
 */
async function installRootHelperInVM(): Promise<void> {
  logger.info('Installing root helper in VM', logFields('install_root_helper'));

  // Import embedded assets
  const { ROOT_HELPER_SCRIPT } = await import('../../root-helper-script.js');
  const { SUDOERS_TEMPLATE, ROOT_HELPER_PATH, SUDOERS_DROP_IN_PATH, ARIG_GROUP } =
    await import('../../sudoers-template.js');

  // Create arig group (idempotent)
  await vmExec(['sudo', 'groupadd', '-f', ARIG_GROUP]);

  // Write root helper script
  await vmExec([
    'sudo', 'bash', '-c',
    `cat > ${ROOT_HELPER_PATH} << 'HELPER_EOF'\n${ROOT_HELPER_SCRIPT}\nHELPER_EOF`,
  ]);
  await vmExec(['sudo', 'chmod', '755', ROOT_HELPER_PATH]);

  // Write sudoers drop-in
  await vmExec([
    'sudo', 'bash', '-c',
    `cat > ${SUDOERS_DROP_IN_PATH} << 'SUDOERS_EOF'\n${SUDOERS_TEMPLATE}\nSUDOERS_EOF`,
  ]);
  await vmExec(['sudo', 'chmod', '440', SUDOERS_DROP_IN_PATH]);

  // Validate sudoers
  const validate = await vmExec(
    ['sudo', 'visudo', '-c', '-f', SUDOERS_DROP_IN_PATH],
    { reject: false },
  );
  if (validate.exitCode !== 0) {
    logger.error('Sudoers validation failed in VM', {
      ...logFields('sudoers_invalid'),
      error: validate.stderr,
    });
    // Remove invalid sudoers to avoid lockout
    await vmExec(['sudo', 'rm', '-f', SUDOERS_DROP_IN_PATH], { reject: false });
    throw new Error(`Sudoers validation failed: ${validate.stderr}`);
  }

  logger.info('Root helper installed in VM', logFields('root_helper_installed'));
}
