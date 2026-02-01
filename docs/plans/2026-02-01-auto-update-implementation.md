# Auto-Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a self-updating distribution system with GitHub Actions releases and background update checking.

**Architecture:** GitHub Actions builds platform-specific binaries on tag push. Install script downloads correct binary to `~/.arig/`. On each command, arig checks for updates in background (12h cooldown), downloads to staging, swaps symlink on next launch.

**Tech Stack:** Bun (compile to binary), GitHub Actions, GitHub Releases API

---

## Phase 1: Update State Management

### Task 1: Update State Types and Loading

**Files:**
- Create: `src/lib/update-state.ts`
- Create: `src/lib/update-state.test.ts`

**Step 1: Write failing test for update state**

Create `src/lib/update-state.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadUpdateState, saveUpdateState, getInstallDir, type UpdateState } from './update-state.js';

describe('update-state', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadUpdateState', () => {
    it('returns default state when file does not exist', async () => {
      const state = await loadUpdateState(testDir);
      expect(state.currentVersion).toBe('0.0.0');
      expect(state.lastCheck).toBeNull();
    });

    it('loads existing state from file', async () => {
      const existingState = {
        currentVersion: '0.1.0',
        lastCheck: '2026-02-01T12:00:00Z',
        pendingVersion: null,
        pendingPath: null,
        downloadStarted: null,
        downloadPid: null,
      };
      await writeFile(join(testDir, 'update.json'), JSON.stringify(existingState));
      const state = await loadUpdateState(testDir);
      expect(state.currentVersion).toBe('0.1.0');
      expect(state.lastCheck).toBe('2026-02-01T12:00:00Z');
    });
  });

  describe('saveUpdateState', () => {
    it('saves state to file', async () => {
      const state: UpdateState = {
        currentVersion: '0.2.0',
        lastCheck: '2026-02-01T14:00:00Z',
        pendingVersion: null,
        pendingPath: null,
        downloadStarted: null,
        downloadPid: null,
      };
      await saveUpdateState(state, testDir);
      const loaded = await loadUpdateState(testDir);
      expect(loaded.currentVersion).toBe('0.2.0');
    });
  });

  describe('getInstallDir', () => {
    it('returns ~/.arig by default', () => {
      const dir = getInstallDir();
      expect(dir).toMatch(/\.arig$/);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/update-state.test.ts`
Expected: FAIL - module not found

**Step 3: Implement update state module**

Create `src/lib/update-state.ts`:

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface UpdateState {
  currentVersion: string;
  lastCheck: string | null;
  pendingVersion: string | null;
  pendingPath: string | null;
  downloadStarted: string | null;
  downloadPid: number | null;
}

const DEFAULT_STATE: UpdateState = {
  currentVersion: '0.0.0',
  lastCheck: null,
  pendingVersion: null,
  pendingPath: null,
  downloadStarted: null,
  downloadPid: null,
};

export function getInstallDir(): string {
  return process.env.ARIG_INSTALL_DIR || join(homedir(), '.arig');
}

export async function loadUpdateState(installDir?: string): Promise<UpdateState> {
  const dir = installDir || getInstallDir();
  const statePath = join(dir, 'update.json');

  try {
    const content = await readFile(statePath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<UpdateState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_STATE;
    }
    throw error;
  }
}

export async function saveUpdateState(state: UpdateState, installDir?: string): Promise<void> {
  const dir = installDir || getInstallDir();
  const statePath = join(dir, 'update.json');
  await writeFile(statePath, JSON.stringify(state, null, 2));
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/lib/update-state.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/update-state.ts src/lib/update-state.test.ts
git commit -m "feat: add update state management"
```

---

### Task 2: Version Comparison Utility

**Files:**
- Create: `src/lib/version.ts`
- Create: `src/lib/version.test.ts`

**Step 1: Write failing test**

Create `src/lib/version.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { compareVersions, isNewerVersion, parseVersion } from './version.js';

describe('version', () => {
  describe('parseVersion', () => {
    it('parses version string', () => {
      const v = parseVersion('1.2.3');
      expect(v).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('handles v prefix', () => {
      const v = parseVersion('v1.2.3');
      expect(v).toEqual({ major: 1, minor: 2, patch: 3 });
    });
  });

  describe('compareVersions', () => {
    it('returns 1 when first is greater', () => {
      expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
      expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    });

    it('returns -1 when first is lesser', () => {
      expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
    });

    it('returns 0 when equal', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });
  });

  describe('isNewerVersion', () => {
    it('returns true when latest is newer', () => {
      expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true);
    });

    it('returns false when latest is same or older', () => {
      expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('1.0.0', '1.1.0')).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/version.test.ts`
Expected: FAIL - module not found

**Step 3: Implement version module**

Create `src/lib/version.ts`:

```typescript
export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(version: string): Version {
  const cleaned = version.replace(/^v/, '');
  const [major, minor, patch] = cleaned.split('.').map(Number);
  return { major: major || 0, minor: minor || 0, patch: patch || 0 };
}

export function compareVersions(a: string, b: string): number {
  const vA = parseVersion(a);
  const vB = parseVersion(b);

  if (vA.major !== vB.major) return vA.major > vB.major ? 1 : -1;
  if (vA.minor !== vB.minor) return vA.minor > vB.minor ? 1 : -1;
  if (vA.patch !== vB.patch) return vA.patch > vB.patch ? 1 : -1;
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/lib/version.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/version.ts src/lib/version.test.ts
git commit -m "feat: add version comparison utility"
```

---

## Phase 2: Update Checker

### Task 3: GitHub Release Fetcher

**Files:**
- Create: `src/lib/github-release.ts`
- Create: `src/lib/github-release.test.ts`

**Step 1: Write failing test**

Create `src/lib/github-release.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getBinaryName, getBinaryUrl, parseReleaseResponse } from './github-release.js';

describe('github-release', () => {
  describe('getBinaryName', () => {
    it('returns correct name for darwin arm64', () => {
      expect(getBinaryName('darwin', 'arm64')).toBe('arig-darwin-arm64');
    });

    it('returns correct name for linux x64', () => {
      expect(getBinaryName('linux', 'x64')).toBe('arig-linux-x64');
    });
  });

  describe('getBinaryUrl', () => {
    it('constructs correct download URL', () => {
      const url = getBinaryUrl('0.2.0', 'darwin', 'arm64');
      expect(url).toBe('https://github.com/lxohi/agent-rig/releases/download/v0.2.0/arig-darwin-arm64');
    });
  });

  describe('parseReleaseResponse', () => {
    it('extracts version from GitHub API response', () => {
      const response = { tag_name: 'v0.2.0', name: 'Release 0.2.0' };
      const version = parseReleaseResponse(response);
      expect(version).toBe('0.2.0');
    });

    it('handles version without v prefix', () => {
      const response = { tag_name: '0.2.0' };
      const version = parseReleaseResponse(response);
      expect(version).toBe('0.2.0');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/github-release.test.ts`
Expected: FAIL - module not found

**Step 3: Implement github release module**

Create `src/lib/github-release.ts`:

```typescript
const REPO = 'lxohi/agent-rig';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

export function getBinaryName(os: string, arch: string): string {
  return `arig-${os}-${arch}`;
}

export function getBinaryUrl(version: string, os: string, arch: string): string {
  const binaryName = getBinaryName(os, arch);
  const tag = version.startsWith('v') ? version : `v${version}`;
  return `https://github.com/${REPO}/releases/download/${tag}/${binaryName}`;
}

export function parseReleaseResponse(response: { tag_name: string }): string {
  return response.tag_name.replace(/^v/, '');
}

export function getPlatform(): { os: string; arch: string } {
  const os = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return { os, arch };
}

export async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(API_URL, {
    headers: { 'User-Agent': 'arig-updater' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch latest version: ${response.status}`);
  }
  const data = await response.json() as { tag_name: string };
  return parseReleaseResponse(data);
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/lib/github-release.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/github-release.ts src/lib/github-release.test.ts
git commit -m "feat: add GitHub release fetcher"
```

---

### Task 4: Symlink Swap Utility

**Files:**
- Create: `src/lib/symlink.ts`
- Create: `src/lib/symlink.test.ts`

**Step 1: Write failing test**

Create `src/lib/symlink.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { swapSymlink, getCurrentVersion } from './symlink.js';

describe('symlink', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
    await mkdir(join(testDir, 'bin'), { recursive: true });
    await mkdir(join(testDir, 'versions', '0.1.0'), { recursive: true });
    await mkdir(join(testDir, 'versions', '0.2.0'), { recursive: true });
    await writeFile(join(testDir, 'versions', '0.1.0', 'arig'), '#!/bin/bash\necho v0.1.0');
    await writeFile(join(testDir, 'versions', '0.2.0', 'arig'), '#!/bin/bash\necho v0.2.0');
    await symlink('../versions/0.1.0/arig', join(testDir, 'bin', 'arig'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('swapSymlink', () => {
    it('updates symlink to new version', async () => {
      await swapSymlink('0.2.0', testDir);
      const target = await readlink(join(testDir, 'bin', 'arig'));
      expect(target).toContain('0.2.0');
    });
  });

  describe('getCurrentVersion', () => {
    it('reads version from symlink target', async () => {
      const version = await getCurrentVersion(testDir);
      expect(version).toBe('0.1.0');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/symlink.test.ts`
Expected: FAIL - module not found

**Step 3: Implement symlink module**

Create `src/lib/symlink.ts`:

```typescript
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
```

**Step 4: Run tests**

Run: `npm run test:run -- src/lib/symlink.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/symlink.ts src/lib/symlink.test.ts
git commit -m "feat: add symlink swap utility"
```

---

## Phase 3: Core Updater Logic

### Task 5: Process Checker Utility

**Files:**
- Create: `src/lib/process.ts`
- Create: `src/lib/process.test.ts`

**Step 1: Write failing test**

Create `src/lib/process.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { processExists } from './process.js';

describe('process', () => {
  describe('processExists', () => {
    it('returns true for current process', () => {
      expect(processExists(process.pid)).toBe(true);
    });

    it('returns false for non-existent process', () => {
      expect(processExists(999999999)).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/process.test.ts`
Expected: FAIL - module not found

**Step 3: Implement process module**

Create `src/lib/process.ts`:

```typescript
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/lib/process.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/process.ts src/lib/process.test.ts
git commit -m "feat: add process checker utility"
```

---

### Task 6: Binary Validator

**Files:**
- Create: `src/lib/binary.ts`
- Create: `src/lib/binary.test.ts`

**Step 1: Write failing test**

Create `src/lib/binary.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isValidBinary } from './binary.js';

describe('binary', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('isValidBinary', () => {
    it('returns true for executable file', async () => {
      const binPath = join(testDir, 'arig');
      await writeFile(binPath, '#!/bin/bash\necho hello');
      await chmod(binPath, 0o755);
      expect(await isValidBinary(binPath)).toBe(true);
    });

    it('returns false for non-existent file', async () => {
      expect(await isValidBinary(join(testDir, 'nonexistent'))).toBe(false);
    });

    it('returns false for empty file', async () => {
      const binPath = join(testDir, 'empty');
      await writeFile(binPath, '');
      expect(await isValidBinary(binPath)).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/binary.test.ts`
Expected: FAIL - module not found

**Step 3: Implement binary module**

Create `src/lib/binary.ts`:

```typescript
import { stat, access, constants } from 'node:fs/promises';

export async function isValidBinary(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    if (stats.size === 0) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/lib/binary.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/binary.ts src/lib/binary.test.ts
git commit -m "feat: add binary validator"
```

---

### Task 7: Main Updater Module

**Files:**
- Create: `src/lib/updater.ts`
- Create: `src/lib/updater.test.ts`

**Step 1: Write failing test**

Create `src/lib/updater.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAndSwap, shouldCheckForUpdate, COOLDOWN_HOURS } from './updater.js';

describe('updater', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
    await mkdir(join(testDir, 'bin'), { recursive: true });
    await mkdir(join(testDir, 'versions', '0.1.0'), { recursive: true });
    await writeFile(join(testDir, 'versions', '0.1.0', 'arig'), '#!/bin/bash\necho v0.1.0');
    await chmod(join(testDir, 'versions', '0.1.0', 'arig'), 0o755);
    await symlink('../versions/0.1.0/arig', join(testDir, 'bin', 'arig'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('shouldCheckForUpdate', () => {
    it('returns true when lastCheck is null', () => {
      expect(shouldCheckForUpdate(null)).toBe(true);
    });

    it('returns true when lastCheck is older than cooldown', () => {
      const oldDate = new Date(Date.now() - (COOLDOWN_HOURS + 1) * 60 * 60 * 1000).toISOString();
      expect(shouldCheckForUpdate(oldDate)).toBe(true);
    });

    it('returns false when lastCheck is recent', () => {
      const recentDate = new Date().toISOString();
      expect(shouldCheckForUpdate(recentDate)).toBe(false);
    });
  });

  describe('checkAndSwap', () => {
    it('swaps to pending version when valid', async () => {
      // Setup pending version
      await mkdir(join(testDir, 'staging', '0.2.0'), { recursive: true });
      await writeFile(join(testDir, 'staging', '0.2.0', 'arig'), '#!/bin/bash\necho v0.2.0');
      await chmod(join(testDir, 'staging', '0.2.0', 'arig'), 0o755);

      // Also create in versions dir for symlink target
      await mkdir(join(testDir, 'versions', '0.2.0'), { recursive: true });
      await writeFile(join(testDir, 'versions', '0.2.0', 'arig'), '#!/bin/bash\necho v0.2.0');
      await chmod(join(testDir, 'versions', '0.2.0', 'arig'), 0o755);

      const state = {
        currentVersion: '0.1.0',
        lastCheck: new Date().toISOString(),
        pendingVersion: '0.2.0',
        pendingPath: join(testDir, 'staging', '0.2.0', 'arig'),
        downloadStarted: null,
        downloadPid: null,
      };
      await writeFile(join(testDir, 'update.json'), JSON.stringify(state));

      const result = await checkAndSwap(testDir);
      expect(result.swapped).toBe(true);
      expect(result.newVersion).toBe('0.2.0');
    });

    it('clears invalid pending version', async () => {
      const state = {
        currentVersion: '0.1.0',
        lastCheck: new Date().toISOString(),
        pendingVersion: '0.2.0',
        pendingPath: join(testDir, 'staging', '0.2.0', 'arig'), // Does not exist
        downloadStarted: null,
        downloadPid: null,
      };
      await writeFile(join(testDir, 'update.json'), JSON.stringify(state));

      const result = await checkAndSwap(testDir);
      expect(result.swapped).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/updater.test.ts`
Expected: FAIL - module not found

**Step 3: Implement updater module**

Create `src/lib/updater.ts`:

```typescript
import { rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
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
```

**Step 4: Run tests**

Run: `npm run test:run -- src/lib/updater.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/updater.ts src/lib/updater.test.ts
git commit -m "feat: add main updater module"
```

---

### Task 8: Background Downloader Script

**Files:**
- Create: `src/lib/downloader.ts`

**Step 1: Implement downloader module**

Create `src/lib/downloader.ts`:

```typescript
import { writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadUpdateState, saveUpdateState, getInstallDir } from './update-state.js';
import { fetchLatestVersion, getBinaryUrl, getPlatform } from './github-release.js';
import { isNewerVersion } from './version.js';

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
```

**Step 2: Commit**

```bash
git add src/lib/downloader.ts
git commit -m "feat: add background downloader"
```

---

### Task 9: Integrate Updater into CLI Entry Point

**Files:**
- Modify: `src/index.tsx`

**Step 1: Add updater import and call**

Update `src/index.tsx` to add at the top after imports:

```typescript
import { checkAndSwap } from './lib/updater.js';
import { spawnBackgroundDownloader } from './lib/downloader.js';

// Check for updates (non-blocking)
checkAndSwap().then((result) => {
  if (result.swapped) {
    console.log(`Updated to v${result.newVersion}`);
  }
  if (result.checkTriggered) {
    spawnBackgroundDownloader();
  }
});
```

The full updated `src/index.tsx`:

```typescript
#!/usr/bin/env node
import { program } from 'commander';
import { checkAndSwap } from './lib/updater.js';
import { spawnBackgroundDownloader } from './lib/downloader.js';
import { listCommand } from './commands/list.js';
import { infoCommand } from './commands/info.js';
import { coreBuildCommand } from './commands/core.js';
import { createCommand } from './commands/create.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { destroyCommand } from './commands/destroy.js';
import { attachCommand } from './commands/attach.js';
import { sshCommand } from './commands/ssh.js';
import { execCommand } from './commands/exec.js';
import { templateListCommand, templatePruneCommand } from './commands/template.js';
import {
  presetListCommand,
  presetCreateCommand,
  presetDeleteCommand,
} from './commands/preset.js';
import {
  completionsBashCommand,
  completionsZshCommand,
  completionsInstallCommand,
} from './commands/completions.js';

// Check for updates (non-blocking)
checkAndSwap().then((result) => {
  if (result.swapped) {
    console.log(`Updated to v${result.newVersion}`);
  }
  if (result.checkTriggered) {
    spawnBackgroundDownloader();
  }
}).catch(() => {
  // Silently ignore update check errors
});

program
  .name('arig')
  .description('CLI tool for creating isolated development environments for coding agents')
  .version('0.1.0');

// ... rest of commands unchanged
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 3: Commit**

```bash
git add src/index.tsx
git commit -m "feat: integrate updater into CLI entry point"
```

---

## Phase 4: GitHub Actions & Install Script

### Task 10: Create GitHub Actions Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: Create workflow file**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-14
            target: darwin-arm64
          - os: macos-13
            target: darwin-x64
          - os: ubuntu-latest
            target: linux-x64
          - os: ubuntu-latest
            target: linux-arm64

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build binary
        run: |
          if [ "${{ matrix.target }}" = "linux-arm64" ]; then
            bun build --compile --target=bun-linux-arm64 --outfile=arig-${{ matrix.target }} src/index.tsx
          else
            bun build --compile --outfile=arig-${{ matrix.target }} src/index.tsx
          fi

      - name: Generate checksum
        run: |
          if [ "${{ runner.os }}" = "macOS" ]; then
            shasum -a 256 arig-${{ matrix.target }} > arig-${{ matrix.target }}.sha256
          else
            sha256sum arig-${{ matrix.target }} > arig-${{ matrix.target }}.sha256
          fi

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: arig-${{ matrix.target }}
          path: |
            arig-${{ matrix.target }}
            arig-${{ matrix.target }}.sha256

  release:
    needs: build
    runs-on: ubuntu-latest

    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            artifacts/arig-darwin-arm64/*
            artifacts/arig-darwin-x64/*
            artifacts/arig-linux-x64/*
            artifacts/arig-linux-arm64/*
          generate_release_notes: true
```

**Step 2: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/release.yml
git commit -m "ci: add GitHub Actions release workflow"
```

---

### Task 11: Create Install Script

**Files:**
- Create: `install.sh`

**Step 1: Create install script**

Create `install.sh`:

```bash
#!/bin/bash
set -e

REPO="lxohi/agent-rig"
INSTALL_DIR="$HOME/.arig"

echo "Installing arig..."

# 1. Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "Error: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

if [ "$OS" != "darwin" ] && [ "$OS" != "linux" ]; then
  echo "Error: Unsupported OS: $OS"
  exit 1
fi

# 2. Get latest version from GitHub API
echo "Fetching latest version..."
VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)

if [ -z "$VERSION" ]; then
  echo "Error: Could not fetch latest version"
  exit 1
fi

VERSION_NUM="${VERSION#v}"

# 3. Download binary
BINARY="arig-${OS}-${ARCH}"
URL="https://github.com/$REPO/releases/download/${VERSION}/${BINARY}"

echo "Downloading $BINARY..."
mkdir -p "$INSTALL_DIR/versions/${VERSION_NUM}"
curl -fsSL "$URL" -o "$INSTALL_DIR/versions/${VERSION_NUM}/arig"
chmod +x "$INSTALL_DIR/versions/${VERSION_NUM}/arig"

# 4. Create symlink
mkdir -p "$INSTALL_DIR/bin"
ln -sf "../versions/${VERSION_NUM}/arig" "$INSTALL_DIR/bin/arig"

# 5. Initialize update.json
cat > "$INSTALL_DIR/update.json" << EOF
{
  "currentVersion": "${VERSION_NUM}",
  "lastCheck": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pendingVersion": null,
  "pendingPath": null,
  "downloadStarted": null,
  "downloadPid": null
}
EOF

# 6. Add to PATH (detect shell, modify rc file)
SHELL_NAME=$(basename "$SHELL")
case "$SHELL_NAME" in
  zsh)  RC_FILE="$HOME/.zshrc" ;;
  bash) RC_FILE="$HOME/.bashrc" ;;
  *)    RC_FILE="$HOME/.profile" ;;
esac

PATH_LINE='export PATH="$HOME/.arig/bin:$PATH"'
if ! grep -q '.arig/bin' "$RC_FILE" 2>/dev/null; then
  echo "" >> "$RC_FILE"
  echo "# arig" >> "$RC_FILE"
  echo "$PATH_LINE" >> "$RC_FILE"
fi

# 7. Print what was done
echo ""
echo "Installed arig ${VERSION} to $INSTALL_DIR"
echo ""
echo "Added to $RC_FILE:"
echo "  $PATH_LINE"
echo ""
echo "Restart your shell or run:"
echo "  source $RC_FILE"
echo ""
echo "Then run:"
echo "  arig --help"
```

**Step 2: Make executable and commit**

```bash
chmod +x install.sh
git add install.sh
git commit -m "feat: add install script"
```

---

### Task 12: Update README with New Installation Instructions

**Files:**
- Modify: `README.md`

**Step 1: Update installation section**

Replace the Installation section in `README.md`:

```markdown
## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/lxohi/agent-rig/main/install.sh | bash
```

This will:
1. Download the latest binary for your platform
2. Install to `~/.arig/`
3. Add `~/.arig/bin` to your PATH

After installation, restart your shell or run `source ~/.zshrc` (or `~/.bashrc`).

**Prerequisites:**
- macOS (Intel or Apple Silicon) or Linux (x64 or arm64)
- [Lima](https://lima-vm.io/) - Install with `brew install lima`

**Auto-updates:** arig checks for updates in the background and automatically updates on next launch.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update installation instructions for binary distribution"
```

---

### Task 13: Add Bun Build Configuration

**Files:**
- Modify: `package.json`

**Step 1: Add bun build scripts**

Add to `package.json` scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "build:binary": "bun build --compile --outfile=arig src/index.tsx",
    "build:binary:all": "npm run build:binary:darwin-arm64 && npm run build:binary:darwin-x64 && npm run build:binary:linux-x64 && npm run build:binary:linux-arm64",
    "build:binary:darwin-arm64": "bun build --compile --target=bun-darwin-arm64 --outfile=arig-darwin-arm64 src/index.tsx",
    "build:binary:darwin-x64": "bun build --compile --target=bun-darwin-x64 --outfile=arig-darwin-x64 src/index.tsx",
    "build:binary:linux-x64": "bun build --compile --target=bun-linux-x64 --outfile=arig-linux-x64 src/index.tsx",
    "build:binary:linux-arm64": "bun build --compile --target=bun-linux-arm64 --outfile=arig-linux-arm64 src/index.tsx",
    "dev": "tsc --watch",
    "test": "vitest",
    "test:run": "vitest run",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  }
}
```

**Step 2: Update .gitignore**

Add to `.gitignore`:

```
arig-darwin-*
arig-linux-*
```

**Step 3: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: add bun build configuration"
```

---

## Phase 5: Testing & Verification

### Task 14: Run All Tests

**Step 1: Run full test suite**

Run: `npm run test:run`
Expected: All tests pass

**Step 2: Build and verify binary locally**

Run: `bun build --compile --outfile=arig-test src/index.tsx`
Run: `./arig-test --help`
Expected: Shows help output

**Step 3: Clean up test binary**

Run: `rm arig-test`

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: complete auto-update implementation"
```

---

## Summary

This plan implements the auto-update mechanism in 14 tasks:

1. **Task 1-2:** Update state management and version comparison
2. **Task 3-4:** GitHub release fetcher and symlink utilities
3. **Task 5-7:** Process checker, binary validator, main updater
4. **Task 8-9:** Background downloader and CLI integration
5. **Task 10-11:** GitHub Actions workflow and install script
6. **Task 12-13:** Documentation and build configuration
7. **Task 14:** Final testing and verification

After implementation, create a release by:
```bash
git tag v0.1.0
git push origin v0.1.0
```

This triggers the GitHub Actions workflow to build and release binaries.
