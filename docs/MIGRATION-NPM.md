# Migration Guide (npm Global Install)

This guide explains how to move from the previous npm-installed `agent-rig` CLI to the redesigned/refactored version on this branch.

## Scope

Use this guide if you installed `agent-rig` with npm globally:

```bash
npm install -g agent-rig
```

## What changed

- Runtime internals were refactored behind a runtime driver abstraction.
- New operational commands were added: `setup`, `diagnose`, `port`, `runtime`.
- `template build` is now deprecated in favor of the new runtime-oriented flow.
- Sandbox config supports new optional fields (`runtime`, `tools`, `ports`) with backward-compatible defaults.

## 1. Verify which `arig` binary you are running

```bash
which -a arig
arig --version
npm ls -g --depth=0 agent-rig
```

If `which -a arig` shows multiple entries, make sure the npm global binary is the one you intend to use.

## 2. Upgrade via npm (not `arig update`)

For npm installs, upgrade with npm:

```bash
npm install -g agent-rig@latest
hash -r
arig --version
```

If you are testing this branch directly instead of a published npm release:

```bash
npm install -g github:lxohi/agent-rig#new_version
hash -r
arig --version
```

## 3. Run diagnostics after upgrade

```bash
arig diagnose
```

This checks platform/runtime prerequisites and permission setup status.

## 4. Platform-specific one-time migration steps

### Linux

Run root-helper setup once:

```bash
sudo arig setup
```

If `sudo` cannot find `arig` (common with `nvm` installs), run:

```bash
sudo "$(command -v arig)" setup
```

Then re-login so group membership changes take effect.

### macOS

If you are moving to the shared VM runtime path, initialize and verify it:

```bash
arig runtime init
arig runtime status
```

## 5. Existing sandboxes and config compatibility

- Existing sandbox configs under `~/.agent-rig/sandboxes/*/config.yml` remain readable.
- Missing new fields are defaulted automatically.
- Existing Lima-based sandboxes can continue to run while you migrate workflows.

Recommended safety backup before large changes:

```bash
cp -a ~/.agent-rig ~/.agent-rig.backup.$(date +%Y%m%d-%H%M%S)
```

## 6. Command mapping (old -> new)

| Previous workflow | New workflow |
| --- | --- |
| `arig template build` | Deprecated. Prefer `arig runtime init` for the new runtime flow. |
| `arig list/info/start/stop/destroy/attach/exec` | Still available; now routed through runtime abstraction. |
| N/A | `arig diagnose` for system and permission checks. |
| N/A | `arig setup` for Linux root-helper permissions. |
| N/A | `arig port add/remove/list` for port mapping management. |
| N/A | `arig runtime status/upgrade/repair` for shared VM runtime operations. |

## 7. Common issues

- `arig` points to an old binary path:
  - Re-check `which -a arig`.
  - Remove stale entries from shell PATH if needed.
- `sudo arig setup` fails with command not found:
  - Use `sudo "$(command -v arig)" setup`.
- Permission warnings after setup:
  - Log out/in and re-run `arig diagnose`.
