import { rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadUpdateState, saveUpdateState, getInstallDir, type UpdateState } from './update-state.js';
import { swapSymlink } from './symlink.js';
import { isValidBinary } from './binary.js';
import { processExists } from './process.js';

export const COOLDOWN_HOURS = 12;
const DOWNLOAD_TIMEOUT_HOURS = 1;

export interface CheckResult {
  swapped: boolean;
  newVersion: string | null;
  checkTriggered: boolean;
}

export function shouldCheckForUpdate(lastCheck: string | null): boolean {
  if (!lastCheck) return true;
  const lastCheckTime = new Date(lastCheck).getTime();
  const cooldownMs = COOLDOWN_HOURS * 60 * 60 * 1000;
  return Date.now() - lastCheckTime > cooldownMs;
}

function isDownloadStale(downloadStarted: string | null): boolean {
  if (!downloadStarted) return true;
  const startTime = new Date(downloadStarted).getTime();
  const timeoutMs = DOWNLOAD_TIMEOUT_HOURS * 60 * 60 * 1000;
  return Date.now() - startTime > timeoutMs;
}

export async function checkAndSwap(installDir?: string): Promise<CheckResult> {
  const dir = installDir || getInstallDir();
  const state = await loadUpdateState(dir);
  const result: CheckResult = { swapped: false, newVersion: null, checkTriggered: false };

  // 1. Swap if pending version ready
  if (state.pendingVersion && state.pendingPath) {
    if (await isValidBinary(state.pendingPath)) {
      // Move from staging to versions
      const versionsDir = join(dir, 'versions', state.pendingVersion);
      await mkdir(versionsDir, { recursive: true });
      await rename(state.pendingPath, join(versionsDir, 'arig'));

      // Swap symlink
      await swapSymlink(state.pendingVersion, dir);

      // Clean up staging
      try {
        await rm(join(dir, 'staging', state.pendingVersion), { recursive: true });
      } catch {
        // Ignore cleanup errors
      }

      // Update state
      state.currentVersion = state.pendingVersion;
      state.pendingVersion = null;
      state.pendingPath = null;
      await saveUpdateState(state, dir);

      result.swapped = true;
      result.newVersion = state.currentVersion;
      return result;
    } else {
      // Invalid pending, clear it
      state.pendingVersion = null;
      state.pendingPath = null;
      await saveUpdateState(state, dir);
    }
  }

  // 2. Check if download in progress
  if (state.downloadPid) {
    const isRunning = processExists(state.downloadPid);
    const isStale = isDownloadStale(state.downloadStarted);

    if (!isRunning || isStale) {
      state.downloadPid = null;
      state.downloadStarted = null;
      await saveUpdateState(state, dir);
    } else {
      // Download in progress, skip check
      return result;
    }
  }

  // 3. Check for updates if cooldown passed
  if (shouldCheckForUpdate(state.lastCheck)) {
    state.lastCheck = new Date().toISOString();
    await saveUpdateState(state, dir);
    result.checkTriggered = true;
    // Spawn background downloader (implemented in Task 8)
  }

  return result;
}
