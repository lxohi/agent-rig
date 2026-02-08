import { invokeRootHelper, validateSandboxUsername } from '../../root-helper-client.js';
import { logger } from '../../logging.js';

const SANDBOX_USER_PREFIX = 'arig_sb_';

/** Derive the Linux username for a sandbox. */
export function sandboxUsername(sandboxName: string): string {
  // Replace hyphens with underscores (Linux usernames can't have hyphens in
  // many distros, and our root helper regex requires [a-z0-9_-]).
  const safe = sandboxName.replace(/-/g, '_');
  return `${SANDBOX_USER_PREFIX}${safe}`;
}

/** Create the Linux user for a sandbox via the root helper. */
export async function createSandboxUser(
  sandboxName: string,
  opts?: { requestId?: string },
): Promise<{ username: string; uid: number }> {
  const username = sandboxUsername(sandboxName);
  validateSandboxUsername(username);

  const logFields = {
    component: 'linux-user',
    event: 'user.create',
    sandbox: sandboxName,
    requestId: opts?.requestId,
  };

  logger.info(`Creating sandbox user ${username}`, logFields);
  await invokeRootHelper('create-user', username, opts?.requestId ? { requestId: opts.requestId } : undefined);

  // Resolve the uid from /etc/passwd via getent
  const uid = await resolveUid(username);
  logger.info(`Sandbox user created: ${username} (uid=${uid})`, { ...logFields, uid });
  return { username, uid };
}

/** Delete the Linux user for a sandbox via the root helper. */
export async function deleteSandboxUser(
  sandboxName: string,
  opts?: { requestId?: string },
): Promise<void> {
  const username = sandboxUsername(sandboxName);
  validateSandboxUsername(username);

  const logFields = {
    component: 'linux-user',
    event: 'user.delete',
    sandbox: sandboxName,
    requestId: opts?.requestId,
  };

  logger.info(`Deleting sandbox user ${username}`, logFields);
  await invokeRootHelper('delete-user', username, opts?.requestId ? { requestId: opts.requestId } : undefined);
  logger.info(`Sandbox user deleted: ${username}`, logFields);
}

/** Resolve a username to its uid via getent. */
async function resolveUid(username: string): Promise<number> {
  const { execa } = await import('execa');
  try {
    const result = await execa('getent', ['passwd', username]);
    // getent passwd output: username:x:uid:gid:...
    const uid = parseInt(result.stdout.split(':')[2], 10);
    if (isNaN(uid)) {
      throw new Error(`Could not parse uid from getent output: ${result.stdout}`);
    }
    return uid;
  } catch (error) {
    throw new Error(`Failed to resolve uid for ${username}: ${(error as Error).message}`);
  }
}
