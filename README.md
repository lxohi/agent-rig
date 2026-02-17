# agent-rig

CLI tool for isolated development sandboxes for coding agents.

## Overview

agent-rig (`arig`) manages sandbox lifecycle, runtime operations, and package/preset setup.

This branch introduces a redesign and runtime refactor:

- Runtime driver abstraction for sandbox operations.
- New operational commands: `setup`, `diagnose`, `port`, and `runtime`.
- `template build` deprecation path for the new runtime-oriented architecture.
- Backward-compatible sandbox config loading for new fields (`runtime`, `tools`, `ports`).

Current default runtime remains Lima-based, while shared-VM/rootless runtime flows are now available through runtime management commands.

## Installation

### npm (global)

```bash
npm install -g agent-rig
hash -r
arig --version
```

### Binary installer

```bash
curl -fsSL https://raw.githubusercontent.com/lxohi/agent-rig/main/install.sh | bash
```

This installs to `~/.arig/` and adds `~/.arig/bin` to PATH.

## Prerequisites

- macOS (Intel or Apple Silicon) or Linux (x64/arm64)
- [Lima](https://lima-vm.io/) for current default runtime and macOS shared-VM runtime commands
- Node.js `>=20` (npm install path)

## Updating

- npm install: upgrade with `npm install -g agent-rig@latest`.
- Binary install (`~/.arig`): use `arig update` (auto-update state is managed there).

## Quick Start

```bash
# 1. Create a sandbox (repo can be auto-detected from current git directory)
arig create my-project --repo https://github.com/user/repo --preset fullstack-dev

# 2. Check status and connect
arig list
arig info my-project
arig ssh my-project

# 3. Optional: add a port mapping
arig port add my-project --host 18080 --target 8080
arig port list my-project

# 4. Stop or destroy when done
arig stop my-project
arig destroy my-project
```

## Command Reference

### Sandbox lifecycle

| Command | Description |
| --- | --- |
| `arig create <name>` | Create a sandbox |
| `arig list` / `arig ls` | List sandboxes with status |
| `arig info <name>` | Show sandbox details |
| `arig start <name>` | Start a sandbox |
| `arig stop <name>` | Stop a sandbox |
| `arig destroy <name>` | Delete a sandbox |

### Sandbox access

| Command | Description |
| --- | --- |
| `arig attach <name>` | Attach to sandbox primary interactive session |
| `arig ssh <name>` | Open a shell as `agent_dev` |
| `arig exec <name> <cmd...>` | Run a command in a sandbox |

### Port management

| Command | Description |
| --- | --- |
| `arig port add <sandbox> --host <p> --target <p>` | Add a port mapping |
| `arig port remove <sandbox> --host <p>` | Remove a port mapping |
| `arig port list <sandbox>` | List port mappings |

### Runtime and operations

| Command | Description |
| --- | --- |
| `arig diagnose` | Run system/runtime diagnostics |
| `arig setup` | Install root-helper permissions (Linux; requires sudo) |
| `arig runtime init` | Initialize shared VM runtime |
| `arig runtime status` | Check shared VM runtime health |
| `arig runtime upgrade --binary <path>` | Upgrade runtime binary in shared VM |
| `arig runtime repair [--binary <path>]` | Repair shared VM runtime |
| `arig update` | Check and download CLI update (binary-install flow) |
| `arig completions install` | Install shell completions |

### Template and presets

| Command | Description |
| --- | --- |
| `arig template list` | List cached templates |
| `arig template prune [n]` | Keep only `n` newest templates |
| `arig template build` | Deprecated alias for rebuilding template/core path |
| `arig preset list` | List presets |
| `arig preset create <name> <packages>` | Create custom preset |
| `arig preset delete <name>` | Delete custom preset |

## Create Options

```bash
arig create <name> [options]

Options:
  --repo <url>          Git repository URL (auto-detected when possible)
  --git-user <user>     Git username for authentication
  --git-token <token>   Git personal access token
  --git-name <name>     Git author name (auto-detected from git config)
  --git-email <email>   Git author email (auto-detected from git config)
  --base-url <url>      Anthropic API base URL
  --auth-token <token>  Anthropic auth token
  --preset <name>       Use a preset
  --packages <list>     Comma-separated package list
  --save-preset <name>  Save this package config as a preset
  --cpus <n>            CPU cores
  --memory <size>       Memory size
  --disk <size>         Disk size
```

## Presets

Built-in presets:

| Preset | Packages | Description |
| --- | --- | --- |
| `fullstack-dev` | `java-17,node-20` | Full stack development with Java and Node |
| `python-ml` | `python-312,uv` | Python machine learning development |
| `frontend` | `node-20` | Frontend development |

Example:

```bash
arig preset create my-stack "node-22,python-312,java-21"
arig create my-project --preset my-stack --repo https://github.com/user/repo
```

## Available Packages

| Package | Description |
| --- | --- |
| `java-17` | OpenJDK 17 |
| `java-21` | OpenJDK 21 |
| `node-20` | Node.js 20 LTS |
| `node-22` | Node.js 22 |
| `python-312` | Python 3.12 |
| `uv` | Fast Python package installer |

Accepted package aliases in `--packages` include:

- `node22` -> `node-22`
- `node20` -> `node-20`
- `jvm17` -> `java-17`
- `jvm21` -> `java-21`
- `python312` / `py312` -> `python-312`

## Runtime Setup Notes

- Linux root-helper setup (one-time):

```bash
sudo arig setup
```

- macOS shared VM runtime setup (if using shared VM path):

```bash
arig runtime init
arig runtime status
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - Internal design and structure
- [Migration (npm install)](docs/MIGRATION-NPM.md) - Upgrade path for npm-installed users

## Development

```bash
npm install
npm run build
npm test
npm run test:run
```

## Shell Completions

```bash
arig completions install
arig completions bash
arig completions zsh
```

## License

MIT
