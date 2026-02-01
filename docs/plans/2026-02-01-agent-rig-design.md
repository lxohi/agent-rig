# agent-rig Design Document

A Node.js CLI tool for creating isolated development environments for coding agents.

## Overview

- **Package name:** `agent-rig`
- **CLI binary:** `arig`
- **Stack:** TypeScript + Commander.js + Ink
- **Backend:** Lima VMs (Ubuntu 24.04)
- **Target:** Individual developers, teams, CI/CD pipelines

## Project Structure

```
agent-rig/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.tsx             # CLI entry point
│   ├── commands/
│   │   ├── create.tsx
│   │   ├── list.tsx
│   │   ├── start.tsx
│   │   ├── stop.tsx
│   │   ├── destroy.tsx
│   │   ├── attach.tsx
│   │   ├── ssh.tsx
│   │   ├── exec.tsx
│   │   ├── info.tsx
│   │   ├── core.tsx
│   │   ├── template.tsx
│   │   └── preset.tsx
│   ├── components/
│   │   ├── Spinner.tsx
│   │   ├── TaskList.tsx
│   │   └── StatusLine.tsx
│   ├── lib/
│   │   ├── lima.ts
│   │   ├── config.ts
│   │   ├── template.ts
│   │   └── sandbox.ts
│   └── assets/
│       └── provision.sh
├── packages/
│   ├── java-17/
│   ├── java-21/
│   ├── node-20/
│   ├── python-312/
│   └── uv/
├── presets.yml
└── config.yml
```

## Command Interface

```
arig <command> [options]

Sandbox Lifecycle:
  arig create <name>          Create a new sandbox
    --repo <url>              Git repository URL (auto-detected from cwd)
    --git-user <user>         Git username
    --git-token <token>       Git personal access token
    --preset <name>           Use a preset (fullstack-dev, python-ml, etc.)
    --packages <list>         Comma-separated packages (java-17,node-20)
    --cpus <n>                CPU cores (default: 4)
    --memory <size>           Memory size (default: 8G)
    --disk <size>             Disk size (default: 30G)

  arig list                   List all sandboxes with status
  arig info <name>            Show detailed sandbox info
  arig start <name>           Start a stopped sandbox
  arig stop <name>            Stop a running sandbox
  arig destroy <name>         Delete a sandbox permanently

Interaction:
  arig attach <name>          Attach to Claude Code tmux session
  arig ssh <name>             SSH into sandbox as agent_dev
  arig exec <name> <cmd>      Execute command in sandbox

Templates:
  arig core build             Build/rebuild core template
  arig template list          List cached templates
  arig template prune [n]     Keep only n most recent templates

Presets:
  arig preset list            List available presets
  arig preset create <name> <packages>
  arig preset delete <name>

Completions:
  arig completions install    Install shell completions
  arig completions bash       Output bash completions
  arig completions zsh        Output zsh completions
```

## Data Storage

Location: `~/.agent-rig/`

```
~/.agent-rig/
├── config.yml                # User's global config
├── presets.yml               # User's custom presets
├── templates/
│   └── index.yml             # Template registry
├── sandboxes/
│   └── <name>/
│       └── config.yml        # Per-sandbox config
└── lima/                     # Lima VM data
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

### Template Index

Tracks:
- Template name and hash (SHA256 of sorted package list)
- Creation timestamp
- Last used timestamp
- Usage count
- Package list

Hash-based deduplication: identical package combinations reuse the same template.

## Template & Sandbox Lifecycle

### Core Template Build (`arig core build`)

1. Create Lima VM from Ubuntu 24.04 cloud image
2. Run `provision.sh`:
   - Essential tools (git, curl, build-essential, etc.)
   - Docker (rootless mode)
   - Mise (version manager)
   - Claude Code CLI (via npm)
   - tmux
3. Configure restricted `agent_dev` user (no sudo)
4. Set up AppArmor profiles and resource limits
5. Stop VM and mark as core template

### Sandbox Creation (`arig create <name>`)

1. Check if core template exists (prompt to build if not)
2. Calculate package hash from requested packages
3. Look up template index:
   - If matching template exists: clone it
   - If not: clone core template, install packages via Mise, save as new template
4. Clone the template to create sandbox VM
5. Configure sandbox:
   - Inject git credentials
   - Set Anthropic environment variables
   - Clone target repository
6. Start VM, start Docker daemon
7. Launch Claude Code in tmux session
8. Save sandbox config to `~/.agent-rig/sandboxes/<name>/`

### Sandbox Destruction (`arig destroy <name>`)

1. Stop VM if running
2. Delete Lima VM
3. Remove sandbox config directory

## Terminal UI

### Spinner with Task Details

```
◐ Creating sandbox "my-project"...
  → Cloning template (java-17, node-20)
  → Configuring git credentials
  → Cloning repository
```

When complete, collapses to:
```
✓ Created sandbox "my-project"
◐ Starting services...
```

### List View

```
NAME          STATUS    REPO                              PACKAGES
my-project    running   github.com/user/repo              java-17, node-20
ml-sandbox    stopped   github.com/user/ml-project        python-312, uv
```

### Info View

```
Sandbox: my-project
Status:  running
Created: 2026-02-01 10:30:00

Repository: https://github.com/user/repo.git
Branch:     main

Packages:
  • java-17 (OpenJDK 17, Gradle 8.5, Maven 3.9.6)
  • node-20 (Node.js 20 LTS)

Resources:
  CPUs:   4
  Memory: 8G (limit: 16G)
  Disk:   30G
```

Colors: Green for success/running, yellow for in-progress, red for errors/stopped, dim for secondary info.

## Error Handling

### Prerequisite Checks

- Check if Lima is installed on first run
- Verify core template exists before `create`

### Sandbox State Validation

- `start` on running sandbox: "Already running"
- `stop` on stopped sandbox: "Already stopped"
- `attach`/`ssh`/`exec` on stopped sandbox: auto-start, then execute
- `create` with existing name: "Sandbox already exists"

### Template Corruption

- Detect on clone failure, offer to rebuild
- Force rebuild: `arig core build --force`

### Graceful Interrupts

- Ctrl+C during `create`: clean up partial sandbox
- Ctrl+C during `core build`: clean up partial template

### Network Failures

- Git clone fails: show error, suggest checking credentials
- Ubuntu image download fails: retry with backoff

## Packages

Installed via Mise:

| Package | Provides |
|---------|----------|
| java-17 | OpenJDK 17, Gradle 8.5, Maven 3.9.6 |
| java-21 | OpenJDK 21, Gradle 8.5, Maven 3.9.6 |
| node-20 | Node.js 20 LTS |
| python-312 | Python 3.12 |
| uv | UV (fast Python package manager) |

## Presets

```yaml
presets:
  fullstack-dev:
    description: "Full stack development with Java and Node"
    packages:
      - java-17
      - node-20
  python-ml:
    description: "Python machine learning development"
    packages:
      - python-312
      - uv
  frontend:
    description: "Frontend development"
    packages:
      - node-20
```

## Installation

```bash
# Via npx
npx agent-rig create my-project

# Global install
npm install -g agent-rig
arig create my-project --preset fullstack-dev
```
