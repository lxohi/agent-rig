import { execa, type ExecaChildProcess } from 'execa';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../logging.js';

/** Configuration for a rootless dockerd instance. */
export interface DaemonConfig {
  username: string;
  uid: number;
  sandboxName: string;
  requestId?: string;
}

/** Paths derived from a sandbox user's uid. */
export interface DaemonPaths {
  socketPath: string;
  dataRoot: string;
  configDir: string;
  pidFile: string;
}

/** Compute standard paths for a sandbox user's rootless dockerd. */
export function daemonPaths(uid: number, username: string): DaemonPaths {
  const runDir = `/run/user/${uid}`;
  const homeDir = `/home/${username}`;
  return {
    socketPath: `${runDir}/docker.sock`,
    dataRoot: `${homeDir}/.local/share/docker`,
    configDir: `${homeDir}/.config/docker`,
    pidFile: `${runDir}/dockerd.pid`,
  };
}

/**
 * Start a rootless dockerd for the given sandbox user.
 * Runs as the sandbox user via `sudo -u <user>`.
 */
export async function startDaemon(config: DaemonConfig): Promise<void> {
  const paths = daemonPaths(config.uid, config.username);
  const logFields = {
    component: 'linux-daemon',
    event: 'daemon.start',
    sandbox: config.sandboxName,
    requestId: config.requestId,
  };

  // Ensure data-root exists
  await execa('sudo', ['-u', config.username, 'mkdir', '-p', paths.dataRoot]);
  await execa('sudo', ['-u', config.username, 'mkdir', '-p', paths.configDir]);

  // Write daemon.json config
  const daemonJson = JSON.stringify({
    'data-root': paths.dataRoot,
    'storage-driver': 'overlay2',
  });
  const configPath = join(paths.configDir, 'daemon.json');
  await execa('sudo', ['-u', config.username, 'tee', configPath], {
    input: daemonJson,
    stdout: 'ignore',
  });

  logger.info(`Starting rootless dockerd for ${config.username}`, logFields);

  // Start dockerd-rootless via systemd --user scope as the sandbox user
  // XDG_RUNTIME_DIR must be set for rootless docker
  await execa('sudo', [
    '-u', config.username,
    '--login',
    'dockerd-rootless-setuptool.sh', 'install',
  ], {
    env: { XDG_RUNTIME_DIR: `/run/user/${config.uid}` },
    reject: false,
  });

  // Start the daemon via systemctl --user as the sandbox user
  await execa('sudo', [
    '-u', config.username,
    '--login',
    'systemctl', '--user', 'start', 'docker',
  ], {
    env: { XDG_RUNTIME_DIR: `/run/user/${config.uid}` },
  });

  // Wait for socket to become available
  await waitForSocket(paths.socketPath, config.uid, config.username);
  logger.info(`Rootless dockerd started for ${config.username}`, logFields);
}

/** Stop the rootless dockerd for a sandbox user. */
export async function stopDaemon(config: DaemonConfig): Promise<void> {
  const logFields = {
    component: 'linux-daemon',
    event: 'daemon.stop',
    sandbox: config.sandboxName,
    requestId: config.requestId,
  };

  logger.info(`Stopping rootless dockerd for ${config.username}`, logFields);

  try {
    await execa('sudo', [
      '-u', config.username,
      '--login',
      'systemctl', '--user', 'stop', 'docker',
    ], {
      env: { XDG_RUNTIME_DIR: `/run/user/${config.uid}` },
      timeout: 30_000,
    });
  } catch (error) {
    logger.warn(`Graceful dockerd stop failed for ${config.username}, force killing`, {
      ...logFields,
      error: (error as Error).message,
    });
    await killUserProcesses(config.uid, config.username);
  }

  logger.info(`Rootless dockerd stopped for ${config.username}`, logFields);
}

/** Check if the rootless dockerd is running for a sandbox user. */
export async function isDaemonRunning(uid: number, username: string): Promise<boolean> {
  try {
    const result = await execa('sudo', [
      '-u', username,
      '--login',
      'systemctl', '--user', 'is-active', 'docker',
    ], {
      env: { XDG_RUNTIME_DIR: `/run/user/${uid}` },
      reject: false,
    });
    return result.stdout.trim() === 'active';
  } catch {
    return false;
  }
}

/** Kill all processes belonging to a sandbox user. */
export async function killUserProcesses(uid: number, username: string): Promise<void> {
  try {
    await execa('sudo', ['pkill', '-u', username], { reject: false });
    // Give processes time to exit
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // Force kill any remaining
    await execa('sudo', ['pkill', '-9', '-u', username], { reject: false });
  } catch {
    // Best effort — user may already have no processes
  }
}

/** Wait for the docker socket to become available. */
async function waitForSocket(
  socketPath: string,
  uid: number,
  username: string,
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await access(socketPath, constants.R_OK);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timed out waiting for docker socket at ${socketPath}`);
}
