import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { logger } from '../../logging.js';
import { vmExec, vmCopyIn, VM_BINARY_PATH, restartArigd } from './vm-manager.js';

const LOG_COMPONENT = 'binary-deploy';

function logFields(event: string) {
  return { component: LOG_COMPONENT, event };
}

/**
 * Compute SHA-256 checksum of a local file.
 */
export async function computeChecksum(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Compute SHA-256 checksum of a file inside the VM.
 */
export async function computeVMChecksum(vmPath: string): Promise<string | undefined> {
  const result = await vmExec(
    ['sha256sum', vmPath],
    { reject: false },
  );
  if (result.exitCode !== 0) return undefined;
  // sha256sum output: "<hash>  <path>"
  return result.stdout.trim().split(/\s+/)[0];
}

export interface DeployResult {
  status: 'success' | 'rolled_back' | 'failed';
  error?: string;
}

/**
 * Deploy a Linux binary into the shared VM with checksum verification
 * and atomic replace. Rolls back on checksum mismatch.
 *
 * Steps:
 * 1. Upload binary to temp path inside VM
 * 2. Verify checksum matches expected
 * 3. Back up current binary (if exists)
 * 4. Atomic replace (mv) to target path
 * 5. Set executable permissions
 * 6. Restart arigd.service
 *
 * On checksum failure: remove temp file, return rolled_back.
 * On replace failure: restore backup, return rolled_back.
 */
export async function deployBinary(
  hostBinaryPath: string,
  expectedChecksum: string,
): Promise<DeployResult> {
  const tmpVMPath = '/tmp/arig-deploy-tmp';
  const backupPath = `${VM_BINARY_PATH}.bak`;

  logger.info('Starting binary deployment', {
    ...logFields('deploy_start'),
    expectedChecksum: expectedChecksum.slice(0, 12),
  });

  // Step 1: Upload to temp path
  try {
    await vmCopyIn(hostBinaryPath, tmpVMPath);
  } catch (error) {
    const msg = `Failed to upload binary: ${(error as Error).message}`;
    logger.error(msg, logFields('deploy_upload_failed'));
    return { status: 'failed', error: msg };
  }

  // Step 2: Verify checksum inside VM
  const vmChecksum = await computeVMChecksum(tmpVMPath);
  if (vmChecksum !== expectedChecksum) {
    logger.error('Checksum mismatch after upload', {
      ...logFields('deploy_checksum_mismatch'),
      expected: expectedChecksum.slice(0, 12),
      actual: vmChecksum?.slice(0, 12),
    });
    await vmExec(['rm', '-f', tmpVMPath], { reject: false });
    return {
      status: 'rolled_back',
      error: `Checksum mismatch: expected ${expectedChecksum.slice(0, 12)}..., got ${vmChecksum?.slice(0, 12) ?? 'none'}...`,
    };
  }

  // Step 3: Back up current binary (if exists)
  const currentExists = await vmExec(
    ['test', '-f', VM_BINARY_PATH],
    { reject: false },
  );
  if (currentExists.exitCode === 0) {
    await vmExec(['sudo', 'cp', VM_BINARY_PATH, backupPath]);
  }

  // Step 4: Atomic replace
  try {
    await vmExec(['sudo', 'mv', tmpVMPath, VM_BINARY_PATH]);
  } catch (error) {
    logger.error('Atomic replace failed, restoring backup', logFields('deploy_replace_failed'));
    if (currentExists.exitCode === 0) {
      await vmExec(['sudo', 'mv', backupPath, VM_BINARY_PATH], { reject: false });
    }
    return {
      status: 'rolled_back',
      error: `Failed to replace binary: ${(error as Error).message}`,
    };
  }

  // Step 5: Set executable permissions
  await vmExec(['sudo', 'chmod', '755', VM_BINARY_PATH]);

  // Step 6: Restart arigd.service
  try {
    await restartArigd();
  } catch (error) {
    logger.warn('arigd restart failed after deploy', {
      ...logFields('deploy_restart_failed'),
      error: (error as Error).message,
    });
    // Not a deployment failure — binary is in place
  }

  // Clean up backup
  await vmExec(['sudo', 'rm', '-f', backupPath], { reject: false });

  logger.info('Binary deployment succeeded', logFields('deploy_success'));
  return { status: 'success' };
}
