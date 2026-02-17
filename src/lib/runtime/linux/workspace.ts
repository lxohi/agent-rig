import { execa } from 'execa';
import { mkdir, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../../logging.js';

/** Standard workspace paths for a sandbox user. */
export interface WorkspacePaths {
  home: string;
  workspace: string;
  configDir: string;
}

/** Compute standard workspace paths for a sandbox user. */
export function workspacePaths(username: string): WorkspacePaths {
  const home = `/home/${username}`;
  return {
    home,
    workspace: join(home, 'workspace'),
    configDir: join(home, '.config', 'agent-rig'),
  };
}

/**
 * Set up the workspace directory structure for a sandbox user.
 * Creates home, workspace, and config directories with correct ownership.
 */
export async function setupWorkspace(
  username: string,
  uid: number,
  opts?: { requestId?: string; sandboxName?: string },
): Promise<WorkspacePaths> {
  const paths = workspacePaths(username);
  const logFields = {
    component: 'linux-workspace',
    event: 'workspace.setup',
    sandbox: opts?.sandboxName,
    requestId: opts?.requestId,
  };

  logger.info(`Setting up workspace for ${username}`, logFields);

  // Create directories as root, then chown to sandbox user
  const dirs = [paths.home, paths.workspace, paths.configDir];
  for (const dir of dirs) {
    await execa('sudo', ['mkdir', '-p', dir]);
    await execa('sudo', ['chown', `${uid}:${uid}`, dir]);
    await execa('sudo', ['chmod', '750', dir]);
  }

  logger.info(`Workspace ready for ${username}`, { ...logFields, paths });
  return paths;
}

/**
 * Remove the workspace directory tree for a sandbox user.
 * Used during destroy to clean up all sandbox data.
 */
export async function removeWorkspace(
  username: string,
  opts?: { requestId?: string; sandboxName?: string },
): Promise<void> {
  const paths = workspacePaths(username);
  const logFields = {
    component: 'linux-workspace',
    event: 'workspace.remove',
    sandbox: opts?.sandboxName,
    requestId: opts?.requestId,
  };

  logger.info(`Removing workspace for ${username}`, logFields);

  // Remove the entire home directory tree
  try {
    await execa('sudo', ['rm', '-rf', paths.home]);
  } catch (error) {
    logger.warn(`Failed to remove workspace for ${username}`, {
      ...logFields,
      error: (error as Error).message,
    });
    throw error;
  }

  logger.info(`Workspace removed for ${username}`, logFields);
}

/** Check if a workspace exists for a sandbox user. */
export async function workspaceExists(username: string): Promise<boolean> {
  const paths = workspacePaths(username);
  try {
    await access(paths.home, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
