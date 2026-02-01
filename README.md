# agent-rig

A CLI tool for creating isolated Lima VM development environments for coding agents.

## Overview

agent-rig (`arig`) manages sandboxed development environments using Lima VMs. Each sandbox is an isolated Ubuntu 24.04 VM with pre-configured tooling, designed for running coding agents like Claude Code in a safe, reproducible environment.

**Key Features:**

- **Isolated VMs** - Each sandbox runs in its own Lima VM with configurable resources
- **Template System** - Hash-based deduplication for efficient sandbox creation
- **Presets** - Pre-configured package combinations for common development stacks
- **Fast Cloning** - New sandboxes clone from cached templates instead of rebuilding

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

## Quick Start

```bash
# 1. Build the core VM template (one-time setup)
arig core build

# 2. Create a sandbox for your project
arig create my-project --repo https://github.com/user/repo --preset fullstack-dev

# 3. Attach to the Claude Code session
arig attach my-project

# 4. When done, stop or destroy the sandbox
arig stop my-project
arig destroy my-project
```

## Commands

### Sandbox Lifecycle

| Command | Description |
|---------|-------------|
| `arig create <name>` | Create a new sandbox |
| `arig list` | List all sandboxes with status |
| `arig info <name>` | Show detailed sandbox information |
| `arig start <name>` | Start a stopped sandbox |
| `arig stop <name>` | Stop a running sandbox |
| `arig destroy <name>` | Permanently delete a sandbox |

### Interaction

| Command | Description |
|---------|-------------|
| `arig attach <name>` | Attach to Claude Code tmux session |
| `arig ssh <name>` | SSH into sandbox as agent_dev user |
| `arig exec <name> <cmd...>` | Execute a command in the sandbox |

### Management

| Command | Description |
|---------|-------------|
| `arig core build` | Build/rebuild the core VM template |
| `arig template list` | List cached templates |
| `arig template prune [n]` | Keep only n most recent templates |
| `arig preset list` | List available presets |
| `arig preset create <name> <packages>` | Create a custom preset |
| `arig preset delete <name>` | Delete a custom preset |
| `arig completions install` | Install shell completions |

## Create Options

```bash
arig create <name> [options]

Options:
  --repo <url>        Git repository URL (auto-detected if in git directory)
  --preset <name>     Use a preset (e.g., fullstack-dev, python-ml, frontend)
  --packages <list>   Comma-separated packages (e.g., node-20,python-312)
  --cpus <n>          Number of CPU cores (default: 4)
  --memory <size>     Memory size (default: 8G)
  --disk <size>       Disk size (default: 30G)
  --git-user <user>   Git username for authentication
  --git-token <token> Git personal access token
```

## Presets

Built-in presets for common development stacks:

| Preset | Packages | Description |
|--------|----------|-------------|
| `fullstack-dev` | java-17, node-20 | Full stack development |
| `python-ml` | python-312, uv | Python machine learning |
| `frontend` | node-20 | Frontend development |

Create custom presets:

```bash
arig preset create my-stack "node-20,python-312,java-21"
arig create my-project --preset my-stack --repo https://github.com/user/repo
```

## Available Packages

| Package | Description |
|---------|-------------|
| `java-17` | OpenJDK 17 |
| `java-21` | OpenJDK 21 |
| `node-20` | Node.js 20 LTS |
| `python-312` | Python 3.12 |
| `uv` | Fast Python package installer |

## Configuration

Sandbox settings are specified via `create` options:

```bash
arig create my-project \
  --repo https://github.com/user/repo \
  --preset fullstack-dev \
  --cpus 8 \
  --memory 16G \
  --disk 50G
```

Custom presets are managed via CLI:

```bash
arig preset create my-stack "node-20,python-312"
arig preset list
arig preset delete my-stack
```

## Development

```bash
npm install      # Install dependencies
npm run build    # Build
npm test         # Run tests in watch mode
npm run test:run # Run tests once
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - Internal design, template system, and code structure

## Shell Completions

```bash
arig completions install  # Auto-detect shell and install
arig completions bash     # Output bash completions
arig completions zsh      # Output zsh completions
```

## License

MIT
