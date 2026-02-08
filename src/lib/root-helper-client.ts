import { execa } from 'execa';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { logger } from './logging.js';
import { ROOT_HELPER_PATH } from './sudoers-template.js';

/** Valid subcommands accepted by the root helper. */
export type RootHelperCommand =
  | 'create-user'
  | 'delete-user'
  | 'ensure-slice'
  | 'cleanup-resources';

const SANDBOX_USERNAME_RE = /^arig_sb_[a-z0-9_-]+$/;

export class RootHelperError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_INSTALLED' | 'PERMISSION_DENIED' | 'INVALID_USERNAME' | 'EXEC_FAILED',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RootHelperError';
  }
}

/**
 * Validate that a sandbox username matches the required pattern.
 * Defense-in-depth: the helper script also validates, but we catch
 * bad names early before invoking sudo.
 */
export function validateSandboxUsername(username: string): void {
  if (!username) {
    throw new RootHelperError(
      'Sandbox username is required',
      'INVALID_USERNAME',
    );
  }
  if (!SANDBOX_USERNAME_RE.test(username)) {
    throw new RootHelperError(
      `Invalid sandbox username "${username}": must match ${SANDBOX_USERNAME_RE}`,
      'INVALID_USERNAME',
    );
  }
}

/** Check whether the root helper is installed at the expected path. */
export async function isRootHelperInstalled(): Promise<boolean> {
  try {
    await access(ROOT_HELPER_PATH, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Invoke the root helper via sudo.
 * Validates the username client-side, logs the invocation, and throws
 * typed errors on failure.
 */
export async function invokeRootHelper(
  command: RootHelperCommand,
  username: string,
  opts?: { requestId?: string },
): Promise<{ stdout: string; stderr: string }> {
  validateSandboxUsername(username);

  const logFields = {
    component: 'root-helper',
    event: `root-helper.${command}`,
    sandbox: username,
    requestId: opts?.requestId,
  };

  // Check helper exists before attempting sudo
  if (!(await isRootHelperInstalled())) {
    logger.error('Root helper not installed', logFields);
    throw new RootHelperError(
      `Root helper not found at ${ROOT_HELPER_PATH}. Run "arig setup" first.`,
      'NOT_INSTALLED',
    );
  }

  logger.info(`Invoking root helper: ${command} ${username}`, logFields);

  try {
    const result = await execa('sudo', [ROOT_HELPER_PATH, command, username]);
    logger.info(`Root helper succeeded: ${command} ${username}`, logFields);
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    const err = error as { stderr?: string; exitCode?: number; message?: string };
    const stderr = err.stderr ?? '';

    if (stderr.includes('permission denied') || stderr.includes('not allowed')) {
      logger.error(`Root helper permission denied: ${command} ${username}`, {
        ...logFields,
        error: stderr,
      });
      throw new RootHelperError(
        `Permission denied invoking root helper. Ensure your user is in the "arig" group and run "arig setup".`,
        'PERMISSION_DENIED',
        error,
      );
    }

    logger.error(`Root helper failed: ${command} ${username}`, {
      ...logFields,
      error: stderr || err.message,
      exitCode: err.exitCode,
    });
    throw new RootHelperError(
      `Root helper "${command}" failed: ${stderr || err.message}`,
      'EXEC_FAILED',
      error,
    );
  }
}
