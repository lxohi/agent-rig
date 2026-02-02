import { writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadUpdateState, saveUpdateState, getInstallDir } from './update-state.js';
import { fetchLatestVersion, getBinaryUrl, getPlatform } from './github-release.js';
import { isNewerVersion } from './version.js';

export interface DownloadResult {
  success: boolean;
  error?: string;
}

/**
 * Download update synchronously (for arig update command)
 */
export async function downloadUpdate(version: string, installDir?: string): Promise<DownloadResult> {
  const dir = installDir || getInstallDir();
  const state = await loadUpdateState(dir);

  try {
    const { os, arch } = getPlatform();
    const url = getBinaryUrl(version, os, arch);

    // Create staging directory
    const stagingDir = join(dir, 'staging', version);
    await mkdir(stagingDir, { recursive: true });

    const tmpPath = join(stagingDir, 'arig.tmp');
    const finalPath = join(stagingDir, 'arig');

    // Download binary
    const response = await fetch(url);
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const buffer = await response.arrayBuffer();
    await writeFile(tmpPath, Buffer.from(buffer));
    await rename(tmpPath, finalPath);
    await chmod(finalPath, 0o755);

    // Update state with pending version
    state.pendingVersion = version;
    state.pendingPath = finalPath;
    state.downloadPid = null;
    state.downloadStarted = null;
    await saveUpdateState(state, dir);

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function downloadInBackground(installDir?: string): Promise<void> {
  const dir = installDir || getInstallDir();
  const state = await loadUpdateState(dir);

  try {
    const latest = await fetchLatestVersion();

    if (!isNewerVersion(latest, state.currentVersion)) {
      return; // Already up to date
    }

    const { os, arch } = getPlatform();
    const url = getBinaryUrl(latest, os, arch);

    // Create staging directory
    const stagingDir = join(dir, 'staging', latest);
    await mkdir(stagingDir, { recursive: true });

    const tmpPath = join(stagingDir, 'arig.tmp');
    const finalPath = join(stagingDir, 'arig');

    // Download binary
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    await writeFile(tmpPath, Buffer.from(buffer));
    await rename(tmpPath, finalPath);
    await chmod(finalPath, 0o755);

    // Update state with pending version
    state.pendingVersion = latest;
    state.pendingPath = finalPath;
    state.downloadPid = null;
    state.downloadStarted = null;
    await saveUpdateState(state, dir);
  } catch (error) {
    // Silent failure - will retry on next check
    state.downloadPid = null;
    state.downloadStarted = null;
    await saveUpdateState(state, dir);
  }
}

export function spawnBackgroundDownloader(installDir?: string): void {
  const dir = installDir || getInstallDir();

  // Spawn detached process that runs the downloader
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
      import('${import.meta.url}').then(m => m.downloadInBackground('${dir}'));
      `,
    ],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, ARIG_INSTALL_DIR: dir },
    }
  );

  child.unref();

  // Save PID to state
  loadUpdateState(dir).then((state) => {
    state.downloadPid = child.pid || null;
    state.downloadStarted = new Date().toISOString();
    saveUpdateState(state, dir);
  });
}
