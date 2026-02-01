# Auto-Update Mechanism Design

## Overview

A self-updating distribution system for arig that:
- Installs via curl-pipe-bash
- Checks for updates in background (non-blocking)
- Downloads new versions silently
- Swaps to new version on next launch

## Directory Structure

```
~/.arig/
├── bin/
│   └── arig -> ../versions/0.1.0/arig   # Symlink to active version
├── versions/
│   ├── 0.1.0/
│   │   └── arig                          # Binary
│   └── 0.2.0/
│       └── arig
├── staging/                               # Downloaded, pending activation
│   └── 0.2.0/
│       └── arig
├── update.json                            # Update state
└── config/                                # Runtime (sandboxes, templates)
```

## Update State File

`~/.arig/update.json`:
```json
{
  "lastCheck": "2026-02-01T20:00:00Z",
  "currentVersion": "0.1.0",
  "pendingVersion": "0.2.0",
  "pendingPath": "~/.arig/staging/0.2.0/arig",
  "downloadStarted": "2026-02-01T20:00:00Z",
  "downloadPid": 12345
}
```

## Update Check Flow

On every `arig` command startup:

```
1. If pendingPath exists AND file is valid:
   → Swap symlink, clear pending state, log "Updated to vX.X.X"

2. If downloadPid exists:
   → Check if process still running
   → If running AND started < 1 hour ago: skip (download in progress)
   → If not running OR started > 1 hour ago: clear download state (failed/stale)

3. If (now - lastCheck) > 12 hours AND no active download:
   → Set downloadStarted + downloadPid
   → Spawn detached download process
   → Update lastCheck

4. Execute command (never blocked)
```

## Background Download Process

1. GET `https://api.github.com/repos/lxohi/agent-rig/releases/latest`
2. Compare version tag with currentVersion
3. If newer:
   - Download binary to `staging/<version>/arig.tmp`
   - On success: rename to `arig`, set pendingVersion in update.json
   - On failure: delete tmp file, exit (next check in 12h will retry)
4. Exit silently

## GitHub Actions Workflow

**Trigger:** On git tag push (`v*`)

**Build matrix:**

| Runner | Target | Output |
|--------|--------|--------|
| `macos-14` (M1) | darwin-arm64 | `arig-darwin-arm64` |
| `macos-13` (Intel) | darwin-x64 | `arig-darwin-x64` |
| `ubuntu-latest` | linux-x64 | `arig-linux-x64` |
| `ubuntu-latest` + cross | linux-arm64 | `arig-linux-arm64` |

**Steps per build:**
1. Checkout code
2. Setup Bun
3. `bun install`
4. `bun build --compile --target=<target> --outfile=arig-<os>-<arch>`
5. Generate SHA256 checksum file
6. Upload artifact

**Release job:**
1. Download all 4 artifacts
2. Create GitHub Release with tag name
3. Upload binaries + checksums to release

## Install Script

`install.sh`:

```bash
#!/bin/bash
set -e

REPO="lxohi/agent-rig"
INSTALL_DIR="$HOME/.arig"

# 1. Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac

# 2. Get latest version from GitHub API
VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)

# 3. Download binary
BINARY="arig-${OS}-${ARCH}"
URL="https://github.com/$REPO/releases/download/${VERSION}/${BINARY}"
mkdir -p "$INSTALL_DIR/versions/${VERSION#v}"
curl -fsSL "$URL" -o "$INSTALL_DIR/versions/${VERSION#v}/arig"
chmod +x "$INSTALL_DIR/versions/${VERSION#v}/arig"

# 4. Create symlink
mkdir -p "$INSTALL_DIR/bin"
ln -sf "../versions/${VERSION#v}/arig" "$INSTALL_DIR/bin/arig"

# 5. Initialize update.json
echo "{\"currentVersion\":\"${VERSION#v}\",\"lastCheck\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$INSTALL_DIR/update.json"

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
  echo "$PATH_LINE" >> "$RC_FILE"
fi

# 7. Print what was done
echo "Installed arig ${VERSION} to $INSTALL_DIR"
echo ""
echo "Added to $RC_FILE:"
echo "  $PATH_LINE"
echo ""
echo "Restart your shell or run: source $RC_FILE"
```

## Update Logic in arig

**On startup (src/lib/updater.ts):**

```typescript
async function checkAndSwap(): Promise<void> {
  const state = loadUpdateState();  // ~/.arig/update.json

  // 1. Swap if pending version ready
  if (state.pendingVersion && state.pendingPath) {
    if (await isValidBinary(state.pendingPath)) {
      swapSymlink(state.pendingVersion);
      clearPendingState();
      console.log(`Updated to v${state.pendingVersion}`);
    } else {
      clearPendingState();  // Invalid/corrupt, clear it
    }
  }

  // 2. Check if download in progress
  if (state.downloadPid) {
    const isRunning = processExists(state.downloadPid);
    const isStale = (now - state.downloadStarted) > 1 hour;
    if (!isRunning || isStale) {
      clearDownloadState();
    } else {
      return;  // Download in progress, skip check
    }
  }

  // 3. Check for updates if cooldown passed
  if ((now - state.lastCheck) > 12 hours) {
    state.lastCheck = now;
    saveUpdateState(state);
    spawnDetachedDownloader();  // Background process
  }
}
```

**Background downloader (spawned detached):**

```typescript
async function downloadUpdate(): Promise<void> {
  const latest = await fetchLatestVersion();  // GitHub API
  const current = loadUpdateState().currentVersion;

  if (!semver.gt(latest, current)) return;

  const url = getBinaryUrl(latest);
  const tmpPath = `~/.arig/staging/${latest}/arig.tmp`;
  const finalPath = `~/.arig/staging/${latest}/arig`;

  await downloadFile(url, tmpPath);
  await rename(tmpPath, finalPath);
  await chmod(finalPath, 0o755);

  updateState({ pendingVersion: latest, pendingPath: finalPath });
}
```

## Files to Create

| File | Purpose |
|------|---------|
| `.github/workflows/release.yml` | Build binaries on tag push |
| `install.sh` | Initial installation script |
| `src/lib/updater.ts` | Update check/swap logic |

## Changes to Existing Files

| File | Change |
|------|--------|
| `src/index.tsx` | Call `checkAndSwap()` on startup |
| `package.json` | Add bun build scripts |

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/lxohi/agent-rig/main/install.sh | bash
```
