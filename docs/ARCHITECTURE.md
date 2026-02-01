# Architecture

This document describes the internal architecture of agent-rig.

## System Overview

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

## Template System

The template system uses a layered approach for efficient sandbox creation:

### Layer 1: Core Template

The base Ubuntu 24.04 VM with essential tools:
- mise (runtime version manager)
- tmux (terminal multiplexer)
- git
- Claude Code

Built once with `arig core build` and reused for all sandboxes.

### Layer 2: Package Templates

Core template + specific packages, cached by content hash.

When you create a sandbox with `--packages node-20,python-312`:
1. Compute hash of sorted package list: `sha256("node-20,python-312")` → `abc123...`
2. Check if template `arig-template-abc123` exists
3. If not, clone core and install packages
4. Cache for future use

### Layer 3: Sandboxes

Cloned from templates with:
- Git repository
- Sandbox-specific configuration
- Running Claude Code session

## Hash-Based Deduplication

```
Packages: [java-17, node-20]     Packages: [node-20, java-17]
         ↓                                ↓
    Sort & Join                      Sort & Join
         ↓                                ↓
  "java-17,node-20"              "java-17,node-20"
         ↓                                ↓
      SHA-256                          SHA-256
         ↓                                ↓
    abc123def...        ===         abc123def...
```

Package order doesn't matter - same packages always produce the same hash, ensuring template reuse.

## Directory Structure

### Project Structure

```
agent-rig/
├── src/
│   ├── index.tsx           # CLI entry point
│   ├── commands/           # Command implementations
│   │   ├── list.tsx
│   │   ├── create.tsx
│   │   ├── start.tsx
│   │   └── ...
│   ├── components/         # Ink UI components
│   │   ├── Spinner.tsx
│   │   ├── TaskList.tsx
│   │   └── StatusLine.tsx
│   ├── lib/                # Core libraries
│   │   ├── config.ts
│   │   ├── presets.ts
│   │   ├── template.ts
│   │   ├── sandbox.ts
│   │   ├── lima.ts
│   │   └── types.ts
│   └── assets/
│       └── provision.sh    # VM provisioning script
├── packages/               # Package definitions
│   ├── java-17/
│   ├── node-20/
│   └── ...
├── config.yml              # Default configuration
└── presets.yml             # Default presets
```

### Runtime Directory (~/.agent-rig/)

```
~/.agent-rig/
├── config.yml              # User configuration
├── presets.yml             # User presets
├── templates/
│   └── index.yml           # Template registry
└── sandboxes/
    └── <name>/
        └── config.yml      # Sandbox configuration
```

## Core Libraries

### config.ts

Handles configuration loading and merging:
- Loads from `~/.agent-rig/config.yml`
- Deep merges with defaults
- Supports `ARIG_CONFIG_DIR` env override

### presets.ts

Manages preset definitions:
- Built-in presets (fullstack-dev, python-ml, frontend)
- User presets from `~/.agent-rig/presets.yml`
- Merges user presets with defaults

### template.ts

Template index management:
- `computePackageHash()` - Deterministic hash from packages
- `loadTemplateIndex()` / `saveTemplateIndex()` - Persist template registry
- `findTemplateByHash()` - Lookup existing templates
- `updateTemplateUsage()` - Track usage for pruning

### sandbox.ts

Sandbox configuration management:
- `saveSandboxConfig()` / `loadSandboxConfig()`
- `listSandboxes()` - Enumerate all sandboxes
- `sandboxExists()` - Check if sandbox exists

### lima.ts

Lima VM operations wrapper:
- `limaList()` - List VMs with status
- `limaCreate()` / `limaStart()` / `limaStop()` / `limaDelete()`
- `limaExec()` - Execute commands in VM
- `buildLimaConfig()` - Generate Lima YAML configuration

## VM Naming Convention

| Type | Pattern | Example |
|------|---------|---------|
| Core template | `arig-core` | `arig-core` |
| Package template | `arig-template-<hash>` | `arig-template-abc123def` |
| Sandbox | `arig-<name>` | `arig-my-project` |

## Sandbox Creation Flow

```
arig create my-project --preset fullstack-dev --repo https://github.com/user/repo
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ 1. Resolve preset to packages │
                    │    fullstack-dev → [java-17,  │
                    │                     node-20]  │
                    └───────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ 2. Check core template exists │
                    │    arig-core must exist       │
                    └───────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ 3. Compute package hash       │
                    │    hash([java-17, node-20])   │
                    │    → abc123def                │
                    └───────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ 4. Find or create template    │
                    │    arig-template-abc123def    │
                    └───────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ 5. Clone template to sandbox  │
                    │    → arig-my-project          │
                    └───────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ 6. Configure sandbox          │
                    │    - Clone git repo           │
                    │    - Start Claude Code        │
                    │    - Save config              │
                    └───────────────────────────────┘
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Language | TypeScript | Type-safe JavaScript |
| CLI Framework | Commander.js | Command parsing and help |
| Terminal UI | Ink (React) | Interactive CLI components |
| Process Execution | execa | Running shell commands |
| YAML Parsing | yaml | Config file handling |
| Testing | Vitest | Unit and integration tests |
| Virtualization | Lima | Linux VMs on macOS |

## Testing Strategy

### Unit Tests

Located alongside source files (`*.test.ts`):
- `config.test.ts` - Config loading/merging
- `presets.test.ts` - Preset management
- `template.test.ts` - Template hashing and index
- `sandbox.test.ts` - Sandbox CRUD operations
- `lima.test.ts` - Lima wrapper functions
- Component tests for Spinner, TaskList, StatusLine

### Integration Tests

`integration.test.ts` - End-to-end CLI testing:
- Runs actual CLI commands via `node dist/index.js`
- Uses temp directories with `ARIG_CONFIG_DIR` override
- Tests error handling and command output

## Package Definitions

Each package in `packages/` contains:

```
packages/<name>/
├── package.yml    # Package metadata
├── install.sh     # Installation script
└── env.sh         # Environment setup
```

Example `package.yml`:
```yaml
name: node-20
version: "20"
description: Node.js 20 LTS
tool: node
```

Packages are installed via mise in the VM during template creation.
