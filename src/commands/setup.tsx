import React from 'react';
import { render } from 'ink';
import { execa } from 'execa';
import { writeFile, chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';
import { ROOT_HELPER_SCRIPT } from '../lib/root-helper-script.js';
import {
  SUDOERS_TEMPLATE,
  ROOT_HELPER_PATH,
  SUDOERS_DROP_IN_PATH,
  ARIG_GROUP,
} from '../lib/sudoers-template.js';

function isRoot(): boolean {
  return process.getuid?.() === 0;
}

async function groupExists(name: string): Promise<boolean> {
  try {
    await execa('getent', ['group', name]);
    return true;
  } catch {
    return false;
  }
}

async function userInGroup(group: string): Promise<boolean> {
  try {
    const { stdout } = await execa('id', ['-nG']);
    return stdout.split(/\s+/).includes(group);
  } catch {
    return false;
  }
}

async function validateSudoers(): Promise<boolean> {
  try {
    await execa('visudo', ['-c', '-f', SUDOERS_DROP_IN_PATH]);
    return true;
  } catch {
    return false;
  }
}

export async function setupCommand(): Promise<void> {
  // Must run as root
  if (!isRoot()) {
    render(
      <StatusLine
        status="error"
        message="arig setup must be run with sudo: sudo arig setup"
      />
    );
    process.exit(1);
  }

  const VALID_USERNAME_RE = /^[a-z_][a-z0-9_-]*[$]?$/;
  const rawSudoUser = process.env.SUDO_USER || '';
  const callingUser = VALID_USERNAME_RE.test(rawSudoUser) ? rawSudoUser : '';
  const steps: string[] = [];

  const { unmount } = render(
    <Spinner message="Running arig setup..." subtasks={steps} />
  );

  try {
    // Step 1: Create arig group
    steps.push('Creating arig group...');
    if (await groupExists(ARIG_GROUP)) {
      steps[steps.length - 1] = 'arig group already exists';
    } else {
      await execa('groupadd', ['--system', ARIG_GROUP]);
      steps[steps.length - 1] = 'Created arig group';
    }

    // Step 2: Add calling user to arig group
    if (callingUser) {
      steps.push(`Adding ${callingUser} to arig group...`);
      await execa('usermod', ['-aG', ARIG_GROUP, callingUser]);
      steps[steps.length - 1] = `Added ${callingUser} to arig group`;
    }

    // Step 3: Install root helper
    steps.push('Installing root helper...');
    await mkdir(dirname(ROOT_HELPER_PATH), { recursive: true });
    await writeFile(ROOT_HELPER_PATH, ROOT_HELPER_SCRIPT, { mode: 0o755 });
    await chmod(ROOT_HELPER_PATH, 0o755);
    steps[steps.length - 1] = 'Installed root helper';

    // Step 4: Install sudoers drop-in
    steps.push('Installing sudoers rules...');
    await writeFile(SUDOERS_DROP_IN_PATH, SUDOERS_TEMPLATE, { mode: 0o440 });
    await chmod(SUDOERS_DROP_IN_PATH, 0o440);

    // Validate sudoers syntax
    const valid = await validateSudoers();
    if (!valid) {
      // Remove invalid sudoers file to avoid locking out sudo
      const { rm } = await import('node:fs/promises');
      await rm(SUDOERS_DROP_IN_PATH, { force: true });
      throw new Error('Sudoers validation failed. File removed for safety.');
    }
    steps[steps.length - 1] = 'Installed sudoers rules';

    // Step 5: Create audit log file
    steps.push('Setting up audit log...');
    const auditLog = '/var/log/arigd-root-helper.log';
    await writeFile(auditLog, '', { flag: 'a' });
    await chmod(auditLog, 0o640);
    steps[steps.length - 1] = 'Audit log ready';

    unmount();
    render(<StatusLine status="success" message="arig setup complete" />);

    if (callingUser) {
      console.log(
        `\nNote: You may need to log out and back in for the "${ARIG_GROUP}" group membership to take effect.`
      );
    }
  } catch (error) {
    unmount();
    render(
      <StatusLine status="error" message={`Setup failed: ${error}`} />
    );
    process.exit(1);
  }
}
