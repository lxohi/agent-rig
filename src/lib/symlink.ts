import { symlink, unlink, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getInstallDir } from './update-state.js';

export async function swapSymlink(newVersion: string, installDir?: string): Promise<void> {
  const dir = installDir || getInstallDir();
  const symlinkPath = join(dir, 'bin', 'arig');
  const newTarget = `../versions/${newVersion}/arig`;

  try {
    await unlink(symlinkPath);
  } catch {
    // Symlink might not exist
  }

  await symlink(newTarget, symlinkPath);
}

export async function getCurrentVersion(installDir?: string): Promise<string | null> {
  const dir = installDir || getInstallDir();
  const symlinkPath = join(dir, 'bin', 'arig');

  try {
    const target = await readlink(symlinkPath);
    // Extract version from path like ../versions/0.1.0/arig
    const match = target.match(/versions\/([^/]+)\//);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
