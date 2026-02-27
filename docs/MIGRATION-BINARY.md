# Migration Guide (Binary Installer via install.sh)

This guide is for users who installed `arig` with:

```bash
curl -fsSL https://raw.githubusercontent.com/lxohi/agent-rig/main/install.sh | bash
```

## Scope

Use this guide when your `arig` binary is managed under `~/.arig`.

Quick check:

```bash
which -a arig
arig --version
ls -la ~/.arig/bin/arig
```

## 1. What `arig update` changes

Binary-install updates only touch `~/.arig`:

- Download target: `~/.arig/staging/<version>/arig`
- Active binary symlink: `~/.arig/bin/arig` -> `~/.arig/versions/<version>/arig`
- Update state file: `~/.arig/update.json`

It does **not** migrate or delete user data in `~/.agent-rig`.

## 2. Where your data lives

| Path | Purpose | Update behavior |
| --- | --- | --- |
| `~/.arig/versions/*` | CLI binaries by version | Updated/added |
| `~/.arig/staging/*` | Download staging area | Temporary; cleaned on swap |
| `~/.arig/update.json` | Auto-update state | Updated |
| `~/.agent-rig/config.yml` | Global config | Preserved |
| `~/.agent-rig/sandboxes/*/config.yml` | Per-sandbox config | Preserved |
| `~/.agent-rig/templates/index.yml` | Template cache index | Preserved |
| `~/.agent-rig/tool-cache/index.yml` | Tool cache index | Preserved |
| `~/.agent-rig/runtime/state.db` | Runtime state DB | Preserved |
| `~/.agent-rig/run/*` | Runtime sockets/session files | Recreated as needed |

## 3. Post-update verification

```bash
arig --version
arig diagnose
arig list
```

If you use macOS shared VM runtime:

```bash
arig runtime status
```

If you use Linux root-helper flow:

```bash
sudo arig setup
```

## 4. Safe backup before manual cleanup

```bash
cp -a ~/.agent-rig ~/.agent-rig.backup.$(date +%Y%m%d-%H%M%S)
cp -a ~/.arig ~/.arig.backup.$(date +%Y%m%d-%H%M%S)
```

## 5. Optional cleanup (only if you want to reclaim/reset state)

Do not run this unless you understand the impact.

```bash
# stop active work first
arig list

# transient runtime sockets/session files (safe, auto-recreated)
rm -rf ~/.agent-rig/run

# reset runtime state database (runtime status metadata will be rebuilt)
mv ~/.agent-rig/runtime/state.db ~/.agent-rig/runtime/state.db.bak.$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
rm -f ~/.agent-rig/runtime/state.db-wal ~/.agent-rig/runtime/state.db-shm

```

## 6. If you switch install methods (npm <-> binary)

- Both install methods can share the same data directory (`~/.agent-rig` by default).
- Keep only one `arig` earlier in PATH to avoid confusion:
  - verify with `which -a arig`
- Do not delete `~/.agent-rig` unless you intend to fully reset sandboxes/config.
