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
# Clone the repository
git clone https://github.com/lxohi/agent-rig.git
cd agent-rig

# Install dependencies
npm install

# Build
npm run build

# Link globally
npm link
```

**Prerequisites:**

- Node.js >= 20.0.0
- [Lima](https://lima-vm.io/) - Install with `brew install lima`

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
# Create a preset
arig preset create my-stack "node-20,python-312,java-21"

# Use it
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

Configuration files are stored in `~/.agent-rig/`:

```
~/.agent-rig/
├── config.yml      # Global configuration
├── presets.yml     # Custom presets
├── templates/      # Template index
└── sandboxes/      # Sandbox configurations
```

### config.yml

```yaml
vm:
  cpus: 4
  memory: "8G"
  disk: "30G"

claude:
  base_url: ""
  auth_token: ""

limits:
  memory_max: "16G"
  cpu_quota: "400%"
  tasks_max: 1024

git:
  user: ""
  email: ""
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        arig CLI                              │
├─────────────────────────────────────────────────────────────┤
│  Commands: create, list, start, stop, destroy, attach, ...  │
├─────────────────────────────────────────────────────────────┤
│                     Core Libraries                           │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐          │
│  │ Config  │ │ Presets │ │ Template │ │ Sandbox │          │
│  └─────────┘ └─────────┘ └──────────┘ └─────────┘          │
├─────────────────────────────────────────────────────────────┤
│                    Lima Integration                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  limactl: create, start, stop, delete, shell, copy   │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                      Lima VMs                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │ Core       │  │ Template   │  │ Sandbox    │            │
│  │ (Ubuntu)   │──│ (+ pkgs)   │──│ (+ repo)   │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

**Template System:**

1. **Core Template** - Base Ubuntu 24.04 VM with essential tools (mise, tmux, git)
2. **Package Templates** - Core + specific packages, cached by hash
3. **Sandboxes** - Cloned from templates with repo and configuration

This layered approach means creating a new sandbox with the same packages reuses the cached template, making sandbox creation fast.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests once
npm run test:run

# Type check
npm run typecheck

# Lint
npm run lint
```

## Tech Stack

- **TypeScript** - Type-safe JavaScript
- **Commander.js** - CLI framework
- **Ink** - React for CLI interfaces
- **Lima** - Linux virtual machines on macOS
- **Vitest** - Testing framework

## Shell Completions

```bash
# Install completions (auto-detects shell)
arig completions install

# Or output directly
arig completions bash >> ~/.bashrc
arig completions zsh >> ~/.zshrc
```

## License

MIT
