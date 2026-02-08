import { platform, arch, release } from 'node:os';
import { access, constants } from 'node:fs/promises';
import { execa } from 'execa';
import { VERSION } from '../version.js';
import { getConfigDir } from '../lib/config.js';
import {
  ROOT_HELPER_PATH,
  SUDOERS_DROP_IN_PATH,
  ARIG_GROUP,
} from '../lib/sudoers-template.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execa('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

async function checkSystem(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  results.push({
    name: 'Platform',
    status: 'ok',
    detail: `${platform()} ${arch()} (${release()})`,
  });

  results.push({
    name: 'arig version',
    status: 'ok',
    detail: VERSION,
  });

  const configDir = getConfigDir();
  const configExists = await fileExists(configDir);
  results.push({
    name: 'Config directory',
    status: configExists ? 'ok' : 'warn',
    detail: configExists ? configDir : `${configDir} (not found)`,
  });

  return results;
}

async function checkPermissions(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const helperExists = await fileExists(ROOT_HELPER_PATH);
  results.push({
    name: 'Root helper',
    status: helperExists ? 'ok' : 'fail',
    detail: helperExists ? ROOT_HELPER_PATH : `${ROOT_HELPER_PATH} (not found — run "sudo arig setup")`,
  });

  const sudoersExists = await fileExists(SUDOERS_DROP_IN_PATH);
  results.push({
    name: 'Sudoers rules',
    status: sudoersExists ? 'ok' : 'fail',
    detail: sudoersExists ? SUDOERS_DROP_IN_PATH : `${SUDOERS_DROP_IN_PATH} (not found — run "sudo arig setup")`,
  });

  try {
    const { stdout } = await execa('id', ['-nG']);
    const inGroup = stdout.split(/\s+/).includes(ARIG_GROUP);
    results.push({
      name: `Group "${ARIG_GROUP}"`,
      status: inGroup ? 'ok' : 'warn',
      detail: inGroup ? 'current user is a member' : 'current user is NOT a member',
    });
  } catch {
    results.push({
      name: `Group "${ARIG_GROUP}"`,
      status: 'warn',
      detail: 'could not check group membership',
    });
  }

  return results;
}

async function checkDependencies(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const plat = platform();

  if (plat === 'linux') {
    for (const cmd of ['systemctl', 'newuidmap', 'newgidmap']) {
      const exists = await commandExists(cmd);
      results.push({
        name: cmd,
        status: exists ? 'ok' : 'fail',
        detail: exists ? 'found' : 'not found — required for rootless sandboxes',
      });
    }
  }

  if (plat === 'darwin') {
    for (const cmd of ['limactl', 'socat']) {
      const exists = await commandExists(cmd);
      results.push({
        name: cmd,
        status: exists ? 'ok' : 'fail',
        detail: exists ? 'found' : 'not found — required for macOS shared VM',
      });
    }
    try {
      const { stdout } = await execa('limactl', ['--version']);
      results.push({ name: 'Lima version', status: 'ok', detail: stdout.trim() });
    } catch {
      // limactl missing already reported above
    }
  }

  const gitExists = await commandExists('git');
  results.push({
    name: 'git',
    status: gitExists ? 'ok' : 'warn',
    detail: gitExists ? 'found' : 'not found',
  });

  return results;
}

function formatStatus(status: CheckResult['status']): string {
  switch (status) {
    case 'ok': return '[OK]';
    case 'warn': return '[WARN]';
    case 'fail': return '[FAIL]';
  }
}

function printSection(title: string, results: CheckResult[]): void {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
  for (const r of results) {
    console.log(`  ${formatStatus(r.status).padEnd(6)} ${r.name}: ${r.detail}`);
  }
}

export async function diagnoseCommand(): Promise<void> {
  console.log('arig diagnostics');

  const [system, permissions, dependencies] = await Promise.all([
    checkSystem(),
    checkPermissions(),
    checkDependencies(),
  ]);

  printSection('System', system);
  printSection('Permissions (Linux)', permissions);
  printSection('Dependencies', dependencies);

  const all = [...system, ...permissions, ...dependencies];
  const fails = all.filter((r) => r.status === 'fail');
  const warns = all.filter((r) => r.status === 'warn');

  console.log('');
  if (fails.length > 0) {
    console.log(`${fails.length} issue(s) found. Run "sudo arig setup" to fix permission issues.`);
    process.exitCode = 1;
  } else if (warns.length > 0) {
    console.log(`All checks passed with ${warns.length} warning(s).`);
  } else {
    console.log('All checks passed.');
  }
}
