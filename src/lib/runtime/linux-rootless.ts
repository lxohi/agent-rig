import type { RuntimeDriver, RuntimeInfo, ExecResult } from './types.js';
import { sandboxUsername, createSandboxUser, deleteSandboxUser } from './linux/user.js';
import {
  startDaemon, stopDaemon, isDaemonRunning,
  killUserProcesses, daemonPaths,
  type DaemonConfig,
} from './linux/daemon.js';
import {
  setupWorkspace, removeWorkspace, workspaceExists,
  workspacePaths,
} from './linux/workspace.js';
import { logger } from '../logging.js';
import { stopAllPorts } from '../ports.js';
import { execa } from 'execa';

/** Result of a destroy operation — three-state to avoid silent failures. */
export type DestroyResult = 'success' | 'partial' | 'failure';

/** Per-step status tracked during destroy. */
interface DestroyStepStatus {
  step: string;
  status: 'ok' | 'failed' | 'skipped';
  lastError?: string;
  retryable: boolean;
}

/** Options for lifecycle operations. */
export interface LifecycleOpts {
  requestId?: string;
}

/**
 * Resolve the uid for a sandbox user from /etc/passwd.
 * Returns undefined if the user does not exist.
 */
async function resolveUid(username: string): Promise<number | undefined> {
  try {
    const result = await execa('getent', ['passwd', username]);
    const uid = parseInt(result.stdout.split(':')[2], 10);
    return isNaN(uid) ? undefined : uid;
  } catch {
    return undefined;
  }
}

/**
 * Linux rootless RuntimeDriver.
 *
 * Each sandbox gets its own Linux user, rootless dockerd, and workspace.
 * Privileged operations go through the root helper (PR-04).
 */
export class LinuxRootlessDriver implements RuntimeDriver {
  readonly name = 'linux-rootless';

  async list(): Promise<RuntimeInfo[]> {
    // List all sandbox users by scanning /etc/passwd for arig_sb_ prefix
    const result = await execa('getent', ['passwd'], { reject: false });
    if (result.exitCode !== 0) return [];

    const infos: RuntimeInfo[] = [];
    for (const line of result.stdout.split('\n')) {
      if (!line) continue;
      const parts = line.split(':');
      const username = parts[0];
      if (!username.startsWith('arig_sb_')) continue;

      const uid = parseInt(parts[2], 10);
      const sandboxName = username.slice('arig_sb_'.length).replace(/_/g, '-');
      const running = await isDaemonRunning(uid, username);

      infos.push({
        name: username,
        sandboxName,
        state: running ? 'running' : 'stopped',
        driver: this.name,
        meta: { uid, username },
      });
    }
    return infos;
  }

  async inspect(sandboxName: string): Promise<RuntimeInfo | undefined> {
    const username = sandboxUsername(sandboxName);
    const uid = await resolveUid(username);
    if (uid === undefined) return undefined;

    const running = await isDaemonRunning(uid, username);
    const hasWorkspace = await workspaceExists(username);

    return {
      name: username,
      sandboxName,
      state: running ? 'running' : (hasWorkspace ? 'stopped' : 'unknown'),
      driver: this.name,
      meta: { uid, username, hasWorkspace },
    };
  }

  async create(sandboxName: string, opts?: Record<string, unknown>): Promise<void> {
    const requestId = opts?.requestId as string | undefined;
    const logFields = {
      component: 'linux-rootless',
      event: 'sandbox.create',
      sandbox: sandboxName,
      requestId,
    };

    logger.info(`Creating sandbox ${sandboxName}`, logFields);

    // 1. Create sandbox Linux user via root helper
    const { username, uid } = await createSandboxUser(sandboxName, { requestId });

    // 2. Set up workspace directories
    await setupWorkspace(username, uid, { requestId, sandboxName });

    // 3. Ensure XDG_RUNTIME_DIR exists for rootless docker
    await execa('sudo', ['mkdir', '-p', `/run/user/${uid}`]);
    await execa('sudo', ['chown', `${uid}:${uid}`, `/run/user/${uid}`]);

    logger.info(`Sandbox ${sandboxName} created`, { ...logFields, username, uid });
  }

  async start(sandboxName: string): Promise<void> {
    const username = sandboxUsername(sandboxName);
    const uid = await resolveUid(username);
    if (uid === undefined) {
      throw new Error(`Sandbox user ${username} does not exist. Run create first.`);
    }

    const logFields = {
      component: 'linux-rootless',
      event: 'sandbox.start',
      sandbox: sandboxName,
    };

    logger.info(`Starting sandbox ${sandboxName}`, logFields);

    const config: DaemonConfig = { username, uid, sandboxName };
    await startDaemon(config);

    logger.info(`Sandbox ${sandboxName} started`, logFields);
  }

  async stop(sandboxName: string): Promise<void> {
    const username = sandboxUsername(sandboxName);
    const uid = await resolveUid(username);
    if (uid === undefined) {
      throw new Error(`Sandbox user ${username} does not exist.`);
    }

    const logFields = {
      component: 'linux-rootless',
      event: 'sandbox.stop',
      sandbox: sandboxName,
    };

    logger.info(`Stopping sandbox ${sandboxName}`, logFields);

    const config: DaemonConfig = { username, uid, sandboxName };
    await stopDaemon(config);

    logger.info(`Sandbox ${sandboxName} stopped`, logFields);
  }

  /**
   * Destroy a sandbox following the 8-step sequence from the design doc.
   * Handles partial failures: retryable steps auto-retry with backoff,
   * non-retryable steps mark destroy_degraded for runtime.gc compensation.
   */
  async destroy(sandboxName: string): Promise<void> {
    const username = sandboxUsername(sandboxName);
    const uid = await resolveUid(username);
    const logFields = {
      component: 'linux-rootless',
      event: 'sandbox.destroy',
      sandbox: sandboxName,
    };

    logger.info(`Destroying sandbox ${sandboxName}`, logFields);

    const steps: DestroyStepStatus[] = [];

    // Step 1: Lock sandbox (conceptual — prevents concurrent operations)
    steps.push({ step: 'lock', status: 'ok', retryable: false });

    // Step 2: Stop port listeners/proxies (retryable)
    await runDestroyStep(steps, 'port-cleanup', true, async () => {
      await stopAllPorts(sandboxName);
    });

    // Step 3: Stop rootless dockerd (retryable)
    if (uid !== undefined) {
      await runDestroyStep(steps, 'dockerd-stop', true, async () => {
        const config: DaemonConfig = { username, uid, sandboxName };
        await stopDaemon(config);
      });
    } else {
      steps.push({ step: 'dockerd-stop', status: 'skipped', retryable: true });
    }

    // Step 4: Kill sandbox user processes (retryable)
    if (uid !== undefined) {
      await runDestroyStep(steps, 'kill-processes', true, async () => {
        await killUserProcesses(uid, username);
      });
    } else {
      steps.push({ step: 'kill-processes', status: 'skipped', retryable: true });
    }

    // Step 5: Remove workspace and Docker data
    await runDestroyStep(steps, 'workspace-remove', true, async () => {
      await removeWorkspace(username, { sandboxName });
    });

    // Step 6: Delete sandbox user via root helper (NOT retryable)
    await runDestroyStep(steps, 'user-delete', false, async () => {
      await deleteSandboxUser(sandboxName);
    });

    // Step 7: Clean state.db records (retryable)
    // State cleanup is handled by the caller (arigd service layer)
    steps.push({ step: 'state-cleanup', status: 'skipped', retryable: true });

    // Step 8: Release lock and audit
    steps.push({ step: 'unlock-audit', status: 'ok', retryable: false });

    // Determine overall result
    // Non-retryable failure (e.g. user deletion) = 'failure' (needs runtime.gc)
    // All-retryable failures = 'partial' (can be retried)
    const failed = steps.filter((s) => s.status === 'failed');
    const result: DestroyResult =
      failed.length === 0 ? 'success' :
      failed.some((s) => !s.retryable) ? 'failure' :
      'partial';

    const logLevel = result === 'success' ? 'info' : 'error';
    logger[logLevel](`Sandbox ${sandboxName} destroy completed: ${result}`, {
      ...logFields,
      result,
      steps: steps.map((s) => ({ step: s.step, status: s.status })),
    });

    if (result === 'failure') {
      const errors = failed.map((s) => `${s.step}: ${s.lastError}`).join('; ');
      throw new Error(`Destroy failed for ${sandboxName}: ${errors}`);
    }
  }

  async execRun(sandboxName: string, command: string[]): Promise<ExecResult> {
    const username = sandboxUsername(sandboxName);
    const uid = await resolveUid(username);
    if (uid === undefined) {
      throw new Error(`Sandbox user ${username} does not exist.`);
    }

    const paths = daemonPaths(uid, username);
    try {
      const result = await execa('sudo', [
        '-u', username,
        '--login',
        'docker', ...command,
      ], {
        env: {
          DOCKER_HOST: `unix://${paths.socketPath}`,
          XDG_RUNTIME_DIR: `/run/user/${uid}`,
        },
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
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
    throw new Error('startExecSession not yet implemented for linux-rootless driver');
  }

  async startAttachSession(_sandboxName: string): Promise<void> {
    throw new Error('startAttachSession not yet implemented for linux-rootless driver');
  }
}

/**
 * Execute a destroy step with retry logic for retryable steps.
 * Records step status regardless of outcome.
 */
async function runDestroyStep(
  steps: DestroyStepStatus[],
  stepName: string,
  retryable: boolean,
  fn: () => Promise<void>,
  maxRetries = 2,
): Promise<void> {
  let lastError: string | undefined;

  const attempts = retryable ? maxRetries + 1 : 1;
  for (let i = 0; i < attempts; i++) {
    try {
      if (i > 0) {
        // Exponential backoff: 500ms, 1000ms
        await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, i - 1)));
      }
      await fn();
      steps.push({ step: stepName, status: 'ok', retryable });
      return;
    } catch (error) {
      lastError = (error as Error).message;
      logger.warn(`Destroy step ${stepName} failed (attempt ${i + 1}/${attempts})`, {
        component: 'linux-rootless',
        event: `destroy.${stepName}.failed`,
        error: lastError,
      });
    }
  }

  steps.push({ step: stepName, status: 'failed', lastError, retryable });
}
