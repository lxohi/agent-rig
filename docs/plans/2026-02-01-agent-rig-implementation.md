# agent-rig Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Node.js CLI tool (`arig`) for creating isolated Lima VM development environments for coding agents.

**Architecture:** TypeScript CLI using Commander.js for command parsing and Ink for terminal UI. Lima VMs provide isolation with Ubuntu 24.04. Template system with hash-based deduplication for efficient sandbox creation.

**Tech Stack:** TypeScript, Commander.js, Ink (React for CLI), Lima, Vitest for testing

---

## Phase 1: Project Foundation

### Task 1: Initialize Node.js Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: Create package.json**

```bash
cd /Volumes/workspace/git/hillion/agent-rig
```

Create `package.json`:

```json
{
  "name": "agent-rig",
  "version": "0.1.0",
  "description": "CLI tool for creating isolated development environments for coding agents",
  "type": "module",
  "bin": {
    "arig": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest",
    "test:run": "vitest run",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "keywords": ["cli", "sandbox", "lima", "development", "agent"],
  "license": "MIT",
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "ink": "^5.0.1",
    "react": "^18.2.0",
    "yaml": "^2.3.4",
    "chalk": "^5.3.0",
    "execa": "^8.0.1",
    "ora": "^8.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.2.0",
    "typescript": "^5.3.0",
    "vitest": "^1.2.0",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.19.0",
    "@typescript-eslint/parser": "^6.19.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Step 3: Update .gitignore**

```
node_modules/
dist/
*.log
.DS_Store
coverage/
```

**Step 4: Install dependencies**

Run: `npm install`
Expected: Dependencies installed successfully

**Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore
git commit -m "chore: initialize Node.js project with TypeScript"
```

---

### Task 2: Create Directory Structure

**Files:**
- Create: `src/index.tsx`
- Create: `src/commands/.gitkeep`
- Create: `src/components/.gitkeep`
- Create: `src/lib/.gitkeep`
- Create: `src/assets/.gitkeep`

**Step 1: Create directory structure**

```bash
mkdir -p src/{commands,components,lib,assets}
```

**Step 2: Create minimal CLI entry point**

Create `src/index.tsx`:

```typescript
#!/usr/bin/env node
import { program } from 'commander';

program
  .name('arig')
  .description('CLI tool for creating isolated development environments for coding agents')
  .version('0.1.0');

program.parse();
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

Run: `node dist/index.js --help`
Expected: Shows help output with description

**Step 4: Commit**

```bash
git add src/
git commit -m "chore: add directory structure and minimal CLI entry"
```

---

## Phase 2: Core Library - Configuration

### Task 3: Config Types and Schema

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/config.ts`
- Create: `src/lib/config.test.ts`

**Step 1: Write failing test for config loading**

Create `src/lib/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, getConfigDir, DEFAULT_CONFIG } from './config.js';

describe('config', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('returns default config when no config file exists', async () => {
      const config = await loadConfig(testDir);
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('loads config from yaml file', async () => {
      await writeFile(
        join(testDir, 'config.yml'),
        'vm:\n  cpus: 8\n  memory: "16G"\n  disk: "50G"'
      );
      const config = await loadConfig(testDir);
      expect(config.vm.cpus).toBe(8);
      expect(config.vm.memory).toBe('16G');
      expect(config.vm.disk).toBe('50G');
    });

    it('merges partial config with defaults', async () => {
      await writeFile(join(testDir, 'config.yml'), 'vm:\n  cpus: 2');
      const config = await loadConfig(testDir);
      expect(config.vm.cpus).toBe(2);
      expect(config.vm.memory).toBe('8G'); // default
    });
  });

  describe('getConfigDir', () => {
    it('returns ~/.agent-rig by default', () => {
      const dir = getConfigDir();
      expect(dir).toMatch(/\.agent-rig$/);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/config.test.ts`
Expected: FAIL - module not found

**Step 3: Create types**

Create `src/lib/types.ts`:

```typescript
export interface VMConfig {
  cpus: number;
  memory: string;
  disk: string;
}

export interface ClaudeConfig {
  base_url: string;
  auth_token: string;
}

export interface LimitsConfig {
  memory_max: string;
  cpu_quota: string;
  tasks_max: number;
}

export interface GitConfig {
  user: string;
  email: string;
}

export interface Config {
  vm: VMConfig;
  claude: ClaudeConfig;
  limits: LimitsConfig;
  git: GitConfig;
}

export interface SandboxConfig {
  name: string;
  repo: string;
  branch: string;
  packages: string[];
  preset?: string;
  vm: VMConfig;
  created: string;
}

export interface TemplateEntry {
  name: string;
  hash: string;
  packages: string[];
  created: string;
  lastUsed: string;
  usageCount: number;
}

export interface TemplateIndex {
  templates: TemplateEntry[];
}

export interface Preset {
  description: string;
  packages: string[];
}

export interface PresetsFile {
  presets: Record<string, Preset>;
}
```

**Step 4: Implement config module**

Create `src/lib/config.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import type { Config } from './types.js';

export const DEFAULT_CONFIG: Config = {
  vm: {
    cpus: 4,
    memory: '8G',
    disk: '30G',
  },
  claude: {
    base_url: '',
    auth_token: '',
  },
  limits: {
    memory_max: '16G',
    cpu_quota: '400%',
    tasks_max: 1024,
  },
  git: {
    user: '',
    email: '',
  },
};

export function getConfigDir(): string {
  return process.env.ARIG_CONFIG_DIR || join(homedir(), '.agent-rig');
}

export async function loadConfig(configDir?: string): Promise<Config> {
  const dir = configDir || getConfigDir();
  const configPath = join(dir, 'config.yml');

  try {
    const content = await readFile(configPath, 'utf-8');
    const parsed = parseYaml(content) as Partial<Config>;
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_CONFIG;
    }
    throw error;
  }
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    if (sourceValue !== undefined) {
      if (
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof result[key] === 'object' &&
        result[key] !== null
      ) {
        result[key] = deepMerge(
          result[key] as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        ) as T[keyof T];
      } else {
        result[key] = sourceValue as T[keyof T];
      }
    }
  }
  return result;
}
```

**Step 5: Run tests**

Run: `npm run test:run -- src/lib/config.test.ts`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/config.ts src/lib/config.test.ts
git commit -m "feat: add config types and loading"
```

---

### Task 4: Presets Loading

**Files:**
- Create: `src/lib/presets.ts`
- Create: `src/lib/presets.test.ts`

**Step 1: Write failing test**

Create `src/lib/presets.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPresets, DEFAULT_PRESETS } from './presets.js';

describe('presets', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadPresets', () => {
    it('returns default presets when no file exists', async () => {
      const presets = await loadPresets(testDir);
      expect(presets).toEqual(DEFAULT_PRESETS);
    });

    it('loads presets from yaml file', async () => {
      await writeFile(
        join(testDir, 'presets.yml'),
        'presets:\n  custom:\n    description: "Custom preset"\n    packages:\n      - node-20'
      );
      const presets = await loadPresets(testDir);
      expect(presets.presets.custom).toBeDefined();
      expect(presets.presets.custom.packages).toEqual(['node-20']);
    });

    it('merges user presets with defaults', async () => {
      await writeFile(
        join(testDir, 'presets.yml'),
        'presets:\n  custom:\n    description: "Custom"\n    packages:\n      - uv'
      );
      const presets = await loadPresets(testDir);
      expect(presets.presets['fullstack-dev']).toBeDefined(); // default
      expect(presets.presets.custom).toBeDefined(); // user
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/presets.test.ts`
Expected: FAIL - module not found

**Step 3: Implement presets module**

Create `src/lib/presets.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { PresetsFile } from './types.js';
import { getConfigDir } from './config.js';

export const DEFAULT_PRESETS: PresetsFile = {
  presets: {
    'fullstack-dev': {
      description: 'Full stack development with Java and Node',
      packages: ['java-17', 'node-20'],
    },
    'python-ml': {
      description: 'Python machine learning development',
      packages: ['python-312', 'uv'],
    },
    frontend: {
      description: 'Frontend development',
      packages: ['node-20'],
    },
  },
};

export async function loadPresets(configDir?: string): Promise<PresetsFile> {
  const dir = configDir || getConfigDir();
  const presetsPath = join(dir, 'presets.yml');

  try {
    const content = await readFile(presetsPath, 'utf-8');
    const parsed = parseYaml(content) as PresetsFile;
    return {
      presets: {
        ...DEFAULT_PRESETS.presets,
        ...parsed.presets,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_PRESETS;
    }
    throw error;
  }
}

export function getPreset(presets: PresetsFile, name: string): string[] | undefined {
  return presets.presets[name]?.packages;
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/lib/presets.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/presets.ts src/lib/presets.test.ts
git commit -m "feat: add presets loading"
```

---

### Task 5: Template Index Management

**Files:**
- Create: `src/lib/template.ts`
- Create: `src/lib/template.test.ts`

**Step 1: Write failing test**

Create `src/lib/template.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computePackageHash,
  loadTemplateIndex,
  saveTemplateIndex,
  findTemplateByHash,
  addTemplate,
} from './template.js';

describe('template', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
    await mkdir(join(testDir, 'templates'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('computePackageHash', () => {
    it('returns consistent hash for same packages', () => {
      const hash1 = computePackageHash(['java-17', 'node-20']);
      const hash2 = computePackageHash(['java-17', 'node-20']);
      expect(hash1).toBe(hash2);
    });

    it('returns same hash regardless of order', () => {
      const hash1 = computePackageHash(['java-17', 'node-20']);
      const hash2 = computePackageHash(['node-20', 'java-17']);
      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different packages', () => {
      const hash1 = computePackageHash(['java-17']);
      const hash2 = computePackageHash(['java-21']);
      expect(hash1).not.toBe(hash2);
    });

    it('returns empty string for empty packages (core template)', () => {
      const hash = computePackageHash([]);
      expect(hash).toBe('');
    });
  });

  describe('loadTemplateIndex', () => {
    it('returns empty index when file does not exist', async () => {
      const index = await loadTemplateIndex(testDir);
      expect(index.templates).toEqual([]);
    });

    it('loads existing index', async () => {
      const indexData = {
        templates: [
          {
            name: 'test-template',
            hash: 'abc123',
            packages: ['java-17'],
            created: '2026-01-01T00:00:00Z',
            lastUsed: '2026-01-01T00:00:00Z',
            usageCount: 1,
          },
        ],
      };
      await writeFile(
        join(testDir, 'templates', 'index.yml'),
        JSON.stringify(indexData)
      );
      const index = await loadTemplateIndex(testDir);
      expect(index.templates).toHaveLength(1);
    });
  });

  describe('findTemplateByHash', () => {
    it('finds template by hash', async () => {
      const index = {
        templates: [
          {
            name: 'test',
            hash: 'abc123',
            packages: ['java-17'],
            created: '2026-01-01T00:00:00Z',
            lastUsed: '2026-01-01T00:00:00Z',
            usageCount: 1,
          },
        ],
      };
      const template = findTemplateByHash(index, 'abc123');
      expect(template?.name).toBe('test');
    });

    it('returns undefined when not found', () => {
      const index = { templates: [] };
      const template = findTemplateByHash(index, 'notfound');
      expect(template).toBeUndefined();
    });
  });

  describe('addTemplate', () => {
    it('adds new template to index', async () => {
      const index = { templates: [] };
      const newIndex = addTemplate(index, {
        name: 'new-template',
        hash: 'xyz789',
        packages: ['node-20'],
        created: '2026-01-01T00:00:00Z',
        lastUsed: '2026-01-01T00:00:00Z',
        usageCount: 1,
      });
      expect(newIndex.templates).toHaveLength(1);
      expect(newIndex.templates[0].name).toBe('new-template');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/template.test.ts`
Expected: FAIL - module not found

**Step 3: Implement template module**

Create `src/lib/template.ts`:

```typescript
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { TemplateIndex, TemplateEntry } from './types.js';
import { getConfigDir } from './config.js';

export function computePackageHash(packages: string[]): string {
  if (packages.length === 0) return '';
  const sorted = [...packages].sort();
  return createHash('sha256').update(sorted.join(',')).digest('hex').slice(0, 12);
}

export async function loadTemplateIndex(configDir?: string): Promise<TemplateIndex> {
  const dir = configDir || getConfigDir();
  const indexPath = join(dir, 'templates', 'index.yml');

  try {
    const content = await readFile(indexPath, 'utf-8');
    return parseYaml(content) as TemplateIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { templates: [] };
    }
    throw error;
  }
}

export async function saveTemplateIndex(
  index: TemplateIndex,
  configDir?: string
): Promise<void> {
  const dir = configDir || getConfigDir();
  const templatesDir = join(dir, 'templates');
  await mkdir(templatesDir, { recursive: true });
  const indexPath = join(templatesDir, 'index.yml');
  await writeFile(indexPath, stringifyYaml(index));
}

export function findTemplateByHash(
  index: TemplateIndex,
  hash: string
): TemplateEntry | undefined {
  return index.templates.find((t) => t.hash === hash);
}

export function addTemplate(
  index: TemplateIndex,
  entry: TemplateEntry
): TemplateIndex {
  return {
    templates: [...index.templates, entry],
  };
}

export function updateTemplateUsage(
  index: TemplateIndex,
  hash: string
): TemplateIndex {
  return {
    templates: index.templates.map((t) =>
      t.hash === hash
        ? { ...t, lastUsed: new Date().toISOString(), usageCount: t.usageCount + 1 }
        : t
    ),
  };
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/lib/template.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/template.ts src/lib/template.test.ts
git commit -m "feat: add template index management"
```

---

## Phase 3: Lima Integration

### Task 6: Lima Wrapper Module

**Files:**
- Create: `src/lib/lima.ts`
- Create: `src/lib/lima.test.ts`

**Step 1: Write failing test**

Create `src/lib/lima.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLimaList, buildLimaConfig } from './lima.js';

describe('lima', () => {
  describe('parseLimaList', () => {
    it('parses lima list JSON output', () => {
      const output = JSON.stringify([
        { name: 'test-vm', status: 'Running', dir: '/path/to/vm', arch: 'aarch64' },
        { name: 'other-vm', status: 'Stopped', dir: '/path/to/other', arch: 'aarch64' },
      ]);
      const vms = parseLimaList(output);
      expect(vms).toHaveLength(2);
      expect(vms[0].name).toBe('test-vm');
      expect(vms[0].status).toBe('Running');
    });

    it('returns empty array for empty output', () => {
      const vms = parseLimaList('[]');
      expect(vms).toEqual([]);
    });
  });

  describe('buildLimaConfig', () => {
    it('builds lima config with defaults', () => {
      const config = buildLimaConfig({
        name: 'test-sandbox',
        cpus: 4,
        memory: '8G',
        disk: '30G',
      });
      expect(config.cpus).toBe(4);
      expect(config.memory).toBe('8G');
      expect(config.disk).toBe('30G');
      expect(config.images).toBeDefined();
    });

    it('includes mount configuration', () => {
      const config = buildLimaConfig({
        name: 'test',
        cpus: 2,
        memory: '4G',
        disk: '20G',
      });
      expect(config.mounts).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/lima.test.ts`
Expected: FAIL - module not found

**Step 3: Implement lima module**

Create `src/lib/lima.ts`:

```typescript
import { execa, type ExecaError } from 'execa';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

export interface LimaVM {
  name: string;
  status: 'Running' | 'Stopped' | 'Broken';
  dir: string;
  arch: string;
}

export interface LimaConfig {
  cpus: number;
  memory: string;
  disk: string;
  images: { location: string; arch: string }[];
  mounts: { location: string; writable: boolean }[];
  provision: { mode: string; script: string }[];
  ssh: { localPort: number };
}

export function parseLimaList(output: string): LimaVM[] {
  try {
    return JSON.parse(output) as LimaVM[];
  } catch {
    return [];
  }
}

export function buildLimaConfig(options: {
  name: string;
  cpus: number;
  memory: string;
  disk: string;
  provisionScript?: string;
}): LimaConfig {
  return {
    cpus: options.cpus,
    memory: options.memory,
    disk: options.disk,
    images: [
      {
        location:
          'https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img',
        arch: 'x86_64',
      },
      {
        location:
          'https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-arm64.img',
        arch: 'aarch64',
      },
    ],
    mounts: [
      { location: '~', writable: false },
      { location: '/tmp/lima', writable: true },
    ],
    provision: options.provisionScript
      ? [{ mode: 'system', script: options.provisionScript }]
      : [],
    ssh: { localPort: 0 },
  };
}

export async function limaList(): Promise<LimaVM[]> {
  try {
    const { stdout } = await execa('limactl', ['list', '--json']);
    return parseLimaList(stdout);
  } catch (error) {
    const execaError = error as ExecaError;
    if (execaError.code === 'ENOENT') {
      throw new Error('Lima is not installed. Please install Lima first: brew install lima');
    }
    throw error;
  }
}

export async function limaStart(name: string): Promise<void> {
  await execa('limactl', ['start', name]);
}

export async function limaStop(name: string): Promise<void> {
  await execa('limactl', ['stop', name]);
}

export async function limaDelete(name: string): Promise<void> {
  await execa('limactl', ['delete', '--force', name]);
}

export async function limaCreate(name: string, configPath: string): Promise<void> {
  await execa('limactl', ['create', '--name', name, configPath]);
}

export async function limaExec(name: string, command: string[]): Promise<string> {
  const { stdout } = await execa('limactl', ['shell', name, '--', ...command]);
  return stdout;
}

export async function limaClone(sourceName: string, targetName: string): Promise<void> {
  // Lima doesn't have native clone, so we copy the disk image
  const configDir = getConfigDir();
  const limaDir = join(configDir, 'lima');
  // This is a simplified version - actual implementation needs disk copy
  await execa('limactl', ['copy', sourceName, targetName]);
}

export function getSandboxVMName(sandboxName: string): string {
  return `arig-${sandboxName}`;
}

export function getTemplateVMName(hash: string): string {
  return hash ? `arig-template-${hash}` : 'arig-core';
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/lib/lima.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/lima.ts src/lib/lima.test.ts
git commit -m "feat: add Lima wrapper module"
```

---

### Task 7: Sandbox Management Module

**Files:**
- Create: `src/lib/sandbox.ts`
- Create: `src/lib/sandbox.test.ts`

**Step 1: Write failing test**

Create `src/lib/sandbox.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSandboxConfig,
  saveSandboxConfig,
  listSandboxes,
  deleteSandboxConfig,
} from './sandbox.js';

describe('sandbox', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
    await mkdir(join(testDir, 'sandboxes'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('saveSandboxConfig', () => {
    it('saves sandbox config to correct location', async () => {
      const config = {
        name: 'test-sandbox',
        repo: 'https://github.com/user/repo.git',
        branch: 'main',
        packages: ['java-17', 'node-20'],
        vm: { cpus: 4, memory: '8G', disk: '30G' },
        created: '2026-01-01T00:00:00Z',
      };
      await saveSandboxConfig(config, testDir);
      const content = await readFile(
        join(testDir, 'sandboxes', 'test-sandbox', 'config.yml'),
        'utf-8'
      );
      expect(content).toContain('test-sandbox');
    });
  });

  describe('loadSandboxConfig', () => {
    it('loads existing sandbox config', async () => {
      await mkdir(join(testDir, 'sandboxes', 'my-sandbox'), { recursive: true });
      await writeFile(
        join(testDir, 'sandboxes', 'my-sandbox', 'config.yml'),
        'name: my-sandbox\nrepo: https://github.com/test/repo.git\nbranch: main\npackages: []\nvm:\n  cpus: 4\n  memory: "8G"\n  disk: "30G"\ncreated: "2026-01-01T00:00:00Z"'
      );
      const config = await loadSandboxConfig('my-sandbox', testDir);
      expect(config.name).toBe('my-sandbox');
      expect(config.repo).toBe('https://github.com/test/repo.git');
    });

    it('throws when sandbox does not exist', async () => {
      await expect(loadSandboxConfig('nonexistent', testDir)).rejects.toThrow();
    });
  });

  describe('listSandboxes', () => {
    it('lists all sandbox names', async () => {
      await mkdir(join(testDir, 'sandboxes', 'sandbox-a'), { recursive: true });
      await mkdir(join(testDir, 'sandboxes', 'sandbox-b'), { recursive: true });
      await writeFile(join(testDir, 'sandboxes', 'sandbox-a', 'config.yml'), 'name: sandbox-a');
      await writeFile(join(testDir, 'sandboxes', 'sandbox-b', 'config.yml'), 'name: sandbox-b');
      const sandboxes = await listSandboxes(testDir);
      expect(sandboxes).toContain('sandbox-a');
      expect(sandboxes).toContain('sandbox-b');
    });

    it('returns empty array when no sandboxes', async () => {
      const sandboxes = await listSandboxes(testDir);
      expect(sandboxes).toEqual([]);
    });
  });

  describe('deleteSandboxConfig', () => {
    it('removes sandbox config directory', async () => {
      await mkdir(join(testDir, 'sandboxes', 'to-delete'), { recursive: true });
      await writeFile(join(testDir, 'sandboxes', 'to-delete', 'config.yml'), 'name: to-delete');
      await deleteSandboxConfig('to-delete', testDir);
      const sandboxes = await listSandboxes(testDir);
      expect(sandboxes).not.toContain('to-delete');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/sandbox.test.ts`
Expected: FAIL - module not found

**Step 3: Implement sandbox module**

Create `src/lib/sandbox.ts`:

```typescript
import { readFile, writeFile, mkdir, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { SandboxConfig } from './types.js';
import { getConfigDir } from './config.js';

export async function saveSandboxConfig(
  config: SandboxConfig,
  configDir?: string
): Promise<void> {
  const dir = configDir || getConfigDir();
  const sandboxDir = join(dir, 'sandboxes', config.name);
  await mkdir(sandboxDir, { recursive: true });
  await writeFile(join(sandboxDir, 'config.yml'), stringifyYaml(config));
}

export async function loadSandboxConfig(
  name: string,
  configDir?: string
): Promise<SandboxConfig> {
  const dir = configDir || getConfigDir();
  const configPath = join(dir, 'sandboxes', name, 'config.yml');
  const content = await readFile(configPath, 'utf-8');
  return parseYaml(content) as SandboxConfig;
}

export async function listSandboxes(configDir?: string): Promise<string[]> {
  const dir = configDir || getConfigDir();
  const sandboxesDir = join(dir, 'sandboxes');

  try {
    const entries = await readdir(sandboxesDir, { withFileTypes: true });
    const sandboxes: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          await access(join(sandboxesDir, entry.name, 'config.yml'));
          sandboxes.push(entry.name);
        } catch {
          // No config.yml, skip
        }
      }
    }

    return sandboxes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function deleteSandboxConfig(
  name: string,
  configDir?: string
): Promise<void> {
  const dir = configDir || getConfigDir();
  const sandboxDir = join(dir, 'sandboxes', name);
  await rm(sandboxDir, { recursive: true, force: true });
}

export async function sandboxExists(
  name: string,
  configDir?: string
): Promise<boolean> {
  const dir = configDir || getConfigDir();
  try {
    await access(join(dir, 'sandboxes', name, 'config.yml'));
    return true;
  } catch {
    return false;
  }
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/lib/sandbox.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/lib/sandbox.ts src/lib/sandbox.test.ts
git commit -m "feat: add sandbox management module"
```

---

## Phase 4: UI Components

### Task 8: Spinner Component

**Files:**
- Create: `src/components/Spinner.tsx`
- Create: `src/components/Spinner.test.tsx`

**Step 1: Write failing test**

Create `src/components/Spinner.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Spinner } from './Spinner.js';

describe('Spinner', () => {
  it('renders with message', () => {
    const { lastFrame } = render(<Spinner message="Loading..." />);
    expect(lastFrame()).toContain('Loading...');
  });

  it('renders with subtasks', () => {
    const { lastFrame } = render(
      <Spinner message="Creating sandbox" subtasks={['Cloning template', 'Configuring']} />
    );
    expect(lastFrame()).toContain('Creating sandbox');
    expect(lastFrame()).toContain('Cloning template');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/components/Spinner.test.tsx`
Expected: FAIL - module not found

**Step 3: Implement Spinner component**

Create `src/components/Spinner.tsx`:

```typescript
import React from 'react';
import { Text, Box } from 'ink';
import { useState, useEffect } from 'react';

const spinnerFrames = ['◐', '◓', '◑', '◒'];

interface SpinnerProps {
  message: string;
  subtasks?: string[];
}

export function Spinner({ message, subtasks = [] }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % spinnerFrames.length);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="yellow">{spinnerFrames[frame]}</Text> {message}
      </Text>
      {subtasks.map((task, i) => (
        <Text key={i} dimColor>
          {'  → '}{task}
        </Text>
      ))}
    </Box>
  );
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/components/Spinner.test.tsx`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/components/Spinner.tsx src/components/Spinner.test.tsx
git commit -m "feat: add Spinner component"
```

---

### Task 9: TaskList Component

**Files:**
- Create: `src/components/TaskList.tsx`
- Create: `src/components/TaskList.test.tsx`

**Step 1: Write failing test**

Create `src/components/TaskList.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { TaskList, type Task } from './TaskList.js';

describe('TaskList', () => {
  it('renders completed tasks with checkmark', () => {
    const tasks: Task[] = [{ label: 'Install packages', status: 'completed' }];
    const { lastFrame } = render(<TaskList tasks={tasks} />);
    expect(lastFrame()).toContain('✓');
    expect(lastFrame()).toContain('Install packages');
  });

  it('renders pending tasks with spinner', () => {
    const tasks: Task[] = [{ label: 'Clone repo', status: 'pending' }];
    const { lastFrame } = render(<TaskList tasks={tasks} />);
    expect(lastFrame()).toContain('Clone repo');
  });

  it('renders failed tasks with X', () => {
    const tasks: Task[] = [{ label: 'Build failed', status: 'failed' }];
    const { lastFrame } = render(<TaskList tasks={tasks} />);
    expect(lastFrame()).toContain('✗');
    expect(lastFrame()).toContain('Build failed');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/components/TaskList.test.tsx`
Expected: FAIL - module not found

**Step 3: Implement TaskList component**

Create `src/components/TaskList.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';

const spinnerFrames = ['◐', '◓', '◑', '◒'];

export interface Task {
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface TaskListProps {
  tasks: Task[];
}

export function TaskList({ tasks }: TaskListProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const hasRunning = tasks.some((t) => t.status === 'running' || t.status === 'pending');
    if (!hasRunning) return;

    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % spinnerFrames.length);
    }, 100);
    return () => clearInterval(timer);
  }, [tasks]);

  return (
    <Box flexDirection="column">
      {tasks.map((task, i) => (
        <Box key={i}>
          <Text>
            {task.status === 'completed' && <Text color="green">✓ </Text>}
            {task.status === 'failed' && <Text color="red">✗ </Text>}
            {(task.status === 'running' || task.status === 'pending') && (
              <Text color="yellow">{spinnerFrames[frame]} </Text>
            )}
            <Text dimColor={task.status === 'completed'}>{task.label}</Text>
          </Text>
        </Box>
      ))}
    </Box>
  );
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/components/TaskList.test.tsx`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/components/TaskList.tsx src/components/TaskList.test.tsx
git commit -m "feat: add TaskList component"
```

---

### Task 10: StatusLine Component

**Files:**
- Create: `src/components/StatusLine.tsx`
- Create: `src/components/StatusLine.test.tsx`

**Step 1: Write failing test**

Create `src/components/StatusLine.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { StatusLine } from './StatusLine.js';

describe('StatusLine', () => {
  it('renders success status in green', () => {
    const { lastFrame } = render(<StatusLine status="success" message="Created sandbox" />);
    expect(lastFrame()).toContain('Created sandbox');
  });

  it('renders error status in red', () => {
    const { lastFrame } = render(<StatusLine status="error" message="Failed to create" />);
    expect(lastFrame()).toContain('Failed to create');
  });

  it('renders info status', () => {
    const { lastFrame } = render(<StatusLine status="info" message="Sandbox running" />);
    expect(lastFrame()).toContain('Sandbox running');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/components/StatusLine.test.tsx`
Expected: FAIL - module not found

**Step 3: Implement StatusLine component**

Create `src/components/StatusLine.tsx`:

```typescript
import React from 'react';
import { Text } from 'ink';

interface StatusLineProps {
  status: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

const statusConfig = {
  success: { symbol: '✓', color: 'green' as const },
  error: { symbol: '✗', color: 'red' as const },
  warning: { symbol: '!', color: 'yellow' as const },
  info: { symbol: '•', color: 'blue' as const },
};

export function StatusLine({ status, message }: StatusLineProps) {
  const config = statusConfig[status];

  return (
    <Text>
      <Text color={config.color}>{config.symbol}</Text> {message}
    </Text>
  );
}
```

**Step 4: Run tests**

Run: `npm run test:run -- src/components/StatusLine.test.tsx`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/components/StatusLine.tsx src/components/StatusLine.test.tsx
git commit -m "feat: add StatusLine component"
```

---

## Phase 5: Commands

### Task 11: List Command

**Files:**
- Create: `src/commands/list.tsx`
- Modify: `src/index.tsx`

**Step 1: Implement list command**

Create `src/commands/list.tsx`:

```typescript
import React from 'react';
import { render, Text, Box } from 'ink';
import { listSandboxes, loadSandboxConfig } from '../lib/sandbox.js';
import { limaList, getSandboxVMName } from '../lib/lima.js';
import type { SandboxConfig } from '../lib/types.js';

interface SandboxInfo {
  config: SandboxConfig;
  status: 'running' | 'stopped' | 'unknown';
}

function ListOutput({ sandboxes }: { sandboxes: SandboxInfo[] }) {
  if (sandboxes.length === 0) {
    return <Text dimColor>No sandboxes found. Create one with: arig create &lt;name&gt;</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={16}><Text bold>NAME</Text></Box>
        <Box width={12}><Text bold>STATUS</Text></Box>
        <Box width={40}><Text bold>REPO</Text></Box>
        <Box><Text bold>PACKAGES</Text></Box>
      </Box>
      {sandboxes.map((sb) => (
        <Box key={sb.config.name}>
          <Box width={16}><Text>{sb.config.name}</Text></Box>
          <Box width={12}>
            <Text color={sb.status === 'running' ? 'green' : 'red'}>
              {sb.status}
            </Text>
          </Box>
          <Box width={40}><Text dimColor>{sb.config.repo}</Text></Box>
          <Box><Text dimColor>{sb.config.packages.join(', ')}</Text></Box>
        </Box>
      ))}
    </Box>
  );
}

export async function listCommand(): Promise<void> {
  const sandboxNames = await listSandboxes();
  const vms = await limaList();

  const sandboxes: SandboxInfo[] = await Promise.all(
    sandboxNames.map(async (name) => {
      const config = await loadSandboxConfig(name);
      const vmName = getSandboxVMName(name);
      const vm = vms.find((v) => v.name === vmName);
      const status = vm?.status === 'Running' ? 'running' : 'stopped';
      return { config, status };
    })
  );

  render(<ListOutput sandboxes={sandboxes} />);
}
```

**Step 2: Register command in index.tsx**

Update `src/index.tsx`:

```typescript
#!/usr/bin/env node
import { program } from 'commander';
import { listCommand } from './commands/list.js';

program
  .name('arig')
  .description('CLI tool for creating isolated development environments for coding agents')
  .version('0.1.0');

program
  .command('list')
  .alias('ls')
  .description('List all sandboxes with status')
  .action(listCommand);

program.parse();
```

**Step 3: Build and test manually**

Run: `npm run build`
Expected: Compiles without errors

Run: `node dist/index.js list`
Expected: Shows "No sandboxes found" message

**Step 4: Commit**

```bash
git add src/commands/list.tsx src/index.tsx
git commit -m "feat: add list command"
```

---

### Task 12: Info Command

**Files:**
- Create: `src/commands/info.tsx`
- Modify: `src/index.tsx`

**Step 1: Implement info command**

Create `src/commands/info.tsx`:

```typescript
import React from 'react';
import { render, Text, Box } from 'ink';
import { loadSandboxConfig, sandboxExists } from '../lib/sandbox.js';
import { limaList, getSandboxVMName } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';

function InfoOutput({
  config,
  status,
}: {
  config: {
    name: string;
    repo: string;
    branch: string;
    packages: string[];
    vm: { cpus: number; memory: string; disk: string };
    created: string;
  };
  status: string;
}) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>Sandbox:</Text> {config.name}
      </Text>
      <Text>
        <Text bold>Status:</Text>{' '}
        <Text color={status === 'running' ? 'green' : 'red'}>{status}</Text>
      </Text>
      <Text>
        <Text bold>Created:</Text> {config.created}
      </Text>
      <Text />
      <Text>
        <Text bold>Repository:</Text> {config.repo}
      </Text>
      <Text>
        <Text bold>Branch:</Text> {config.branch}
      </Text>
      <Text />
      <Text bold>Packages:</Text>
      {config.packages.length === 0 ? (
        <Text dimColor>  (none)</Text>
      ) : (
        config.packages.map((pkg) => (
          <Text key={pkg}>  • {pkg}</Text>
        ))
      )}
      <Text />
      <Text bold>Resources:</Text>
      <Text>  CPUs:   {config.vm.cpus}</Text>
      <Text>  Memory: {config.vm.memory}</Text>
      <Text>  Disk:   {config.vm.disk}</Text>
    </Box>
  );
}

export async function infoCommand(name: string): Promise<void> {
  const exists = await sandboxExists(name);
  if (!exists) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const config = await loadSandboxConfig(name);
  const vms = await limaList();
  const vmName = getSandboxVMName(name);
  const vm = vms.find((v) => v.name === vmName);
  const status = vm?.status === 'Running' ? 'running' : 'stopped';

  render(<InfoOutput config={config} status={status} />);
}
```

**Step 2: Register command**

Add to `src/index.tsx` after list command:

```typescript
import { infoCommand } from './commands/info.js';

// ... after list command registration

program
  .command('info <name>')
  .description('Show detailed sandbox info')
  .action(infoCommand);
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add src/commands/info.tsx src/index.tsx
git commit -m "feat: add info command"
```

---

### Task 13: Core Build Command

**Files:**
- Create: `src/commands/core.tsx`
- Copy: `reftemp/agent-sandbox/core/provision.sh` → `src/assets/provision.sh`
- Modify: `src/index.tsx`

**Step 1: Copy provision script**

```bash
cp reftemp/agent-sandbox/core/provision.sh src/assets/provision.sh
```

**Step 2: Implement core command**

Create `src/commands/core.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { render, Text, Box } from 'ink';
import { readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  limaCreate,
  limaStart,
  limaStop,
  limaDelete,
  getTemplateVMName,
  buildLimaConfig,
} from '../lib/lima.js';
import { loadConfig } from '../lib/config.js';
import { TaskList, type Task } from '../components/TaskList.js';
import { StatusLine } from '../components/StatusLine.js';
import { stringify as stringifyYaml } from 'yaml';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CoreBuildProps {
  force: boolean;
}

function CoreBuildUI({ tasks, error }: { tasks: Task[]; error?: string }) {
  return (
    <Box flexDirection="column">
      <TaskList tasks={tasks} />
      {error && <StatusLine status="error" message={error} />}
    </Box>
  );
}

export async function coreBuildCommand(options: { force?: boolean }): Promise<void> {
  const vmName = getTemplateVMName('');
  const config = await loadConfig();

  // Check if core template already exists
  if (!options.force) {
    try {
      // Check if VM exists by trying to get its status
      const { execa } = await import('execa');
      const { stdout } = await execa('limactl', ['list', '--json']);
      const vms = JSON.parse(stdout);
      if (vms.some((vm: { name: string }) => vm.name === vmName)) {
        render(
          <StatusLine
            status="info"
            message={`Core template already exists. Use --force to rebuild.`}
          />
        );
        return;
      }
    } catch {
      // VM doesn't exist, continue
    }
  }

  const tasks: Task[] = [
    { label: 'Creating Lima VM', status: 'pending' },
    { label: 'Running provisioning script', status: 'pending' },
    { label: 'Stopping VM for template', status: 'pending' },
  ];

  let currentTask = 0;
  const updateTask = (status: Task['status']) => {
    tasks[currentTask].status = status;
  };

  const { rerender, unmount } = render(<CoreBuildUI tasks={tasks} />);

  try {
    // Delete existing if force
    if (options.force) {
      try {
        await limaDelete(vmName);
      } catch {
        // Ignore if doesn't exist
      }
    }

    // Step 1: Create Lima VM
    updateTask('running');
    rerender(<CoreBuildUI tasks={tasks} />);

    const provisionScript = await readFile(
      join(__dirname, '..', 'assets', 'provision.sh'),
      'utf-8'
    );

    const limaConfig = buildLimaConfig({
      name: vmName,
      cpus: config.vm.cpus,
      memory: config.vm.memory,
      disk: config.vm.disk,
      provisionScript,
    });

    // Write lima config to temp file
    const configPath = join(tmpdir(), `${vmName}.yaml`);
    await writeFile(configPath, stringifyYaml(limaConfig));

    await limaCreate(vmName, configPath);
    updateTask('completed');
    currentTask++;

    // Step 2: Start and provision
    updateTask('running');
    rerender(<CoreBuildUI tasks={tasks} />);
    await limaStart(vmName);
    updateTask('completed');
    currentTask++;

    // Step 3: Stop for template
    updateTask('running');
    rerender(<CoreBuildUI tasks={tasks} />);
    await limaStop(vmName);
    updateTask('completed');

    rerender(<CoreBuildUI tasks={tasks} />);
    unmount();
    render(<StatusLine status="success" message="Core template built successfully" />);
  } catch (error) {
    updateTask('failed');
    rerender(<CoreBuildUI tasks={tasks} error={String(error)} />);
    unmount();
    process.exit(1);
  }
}
```

**Step 3: Register command**

Add to `src/index.tsx`:

```typescript
import { coreBuildCommand } from './commands/core.js';

// ... after other commands

const coreCmd = program.command('core').description('Core template management');

coreCmd
  .command('build')
  .description('Build/rebuild core template')
  .option('-f, --force', 'Force rebuild even if exists')
  .action(coreBuildCommand);
```

**Step 4: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add src/commands/core.tsx src/assets/provision.sh src/index.tsx
git commit -m "feat: add core build command"
```

---

### Task 14: Create Command

**Files:**
- Create: `src/commands/create.tsx`
- Modify: `src/index.tsx`

**Step 1: Implement create command**

Create `src/commands/create.tsx`:

```typescript
import React from 'react';
import { render, Box } from 'ink';
import { execa } from 'execa';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig, getConfigDir } from '../lib/config.js';
import { loadPresets, getPreset } from '../lib/presets.js';
import {
  computePackageHash,
  loadTemplateIndex,
  saveTemplateIndex,
  findTemplateByHash,
  addTemplate,
  updateTemplateUsage,
} from '../lib/template.js';
import { saveSandboxConfig, sandboxExists } from '../lib/sandbox.js';
import {
  limaCreate,
  limaStart,
  limaExec,
  getSandboxVMName,
  getTemplateVMName,
  buildLimaConfig,
  limaList,
} from '../lib/lima.js';
import { TaskList, type Task } from '../components/TaskList.js';
import { StatusLine } from '../components/StatusLine.js';
import type { SandboxConfig } from '../lib/types.js';

interface CreateOptions {
  repo?: string;
  gitUser?: string;
  gitToken?: string;
  preset?: string;
  packages?: string;
  cpus?: string;
  memory?: string;
  disk?: string;
}

async function detectGitRepo(): Promise<string | undefined> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin']);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function CreateUI({ tasks, error }: { tasks: Task[]; error?: string }) {
  return (
    <Box flexDirection="column">
      <TaskList tasks={tasks} />
      {error && <StatusLine status="error" message={error} />}
    </Box>
  );
}

export async function createCommand(
  name: string,
  options: CreateOptions
): Promise<void> {
  // Check if sandbox already exists
  if (await sandboxExists(name)) {
    render(
      <StatusLine status="error" message={`Sandbox "${name}" already exists`} />
    );
    process.exit(1);
  }

  const config = await loadConfig();
  const presets = await loadPresets();

  // Determine packages
  let packages: string[] = [];
  if (options.preset) {
    const presetPackages = getPreset(presets, options.preset);
    if (!presetPackages) {
      render(
        <StatusLine status="error" message={`Preset "${options.preset}" not found`} />
      );
      process.exit(1);
    }
    packages = presetPackages;
  } else if (options.packages) {
    packages = options.packages.split(',').map((p) => p.trim());
  }

  // Determine repo
  const repo = options.repo || (await detectGitRepo());
  if (!repo) {
    render(
      <StatusLine
        status="error"
        message="No repository specified and not in a git directory. Use --repo to specify."
      />
    );
    process.exit(1);
  }

  const tasks: Task[] = [
    { label: 'Checking core template', status: 'pending' },
    { label: 'Preparing template', status: 'pending' },
    { label: 'Creating sandbox VM', status: 'pending' },
    { label: 'Configuring sandbox', status: 'pending' },
    { label: 'Cloning repository', status: 'pending' },
    { label: 'Starting Claude Code', status: 'pending' },
  ];

  let currentTask = 0;
  const updateTask = (status: Task['status']) => {
    tasks[currentTask].status = status;
  };
  const nextTask = () => {
    updateTask('completed');
    currentTask++;
    if (currentTask < tasks.length) {
      updateTask('running');
    }
  };

  const { rerender, unmount } = render(<CreateUI tasks={tasks} />);

  try {
    // Step 1: Check core template
    updateTask('running');
    rerender(<CreateUI tasks={tasks} />);

    const vms = await limaList();
    const coreVMName = getTemplateVMName('');
    if (!vms.some((vm) => vm.name === coreVMName)) {
      updateTask('failed');
      rerender(
        <CreateUI
          tasks={tasks}
          error="Core template not found. Run: arig core build"
        />
      );
      unmount();
      process.exit(1);
    }
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 2: Prepare template (find or create)
    const packageHash = computePackageHash(packages);
    let templateIndex = await loadTemplateIndex();
    let templateVMName: string;

    if (packages.length === 0) {
      // Use core template directly
      templateVMName = coreVMName;
    } else {
      const existingTemplate = findTemplateByHash(templateIndex, packageHash);
      if (existingTemplate) {
        templateVMName = getTemplateVMName(packageHash);
        templateIndex = updateTemplateUsage(templateIndex, packageHash);
        await saveTemplateIndex(templateIndex);
      } else {
        // Create new template from core
        templateVMName = getTemplateVMName(packageHash);
        // Clone core and install packages
        await execa('limactl', ['copy', coreVMName, templateVMName]);
        await limaStart(templateVMName);

        // Install packages via mise
        for (const pkg of packages) {
          await limaExec(templateVMName, [
            'sudo',
            '-u',
            'agent_dev',
            'bash',
            '-c',
            `source ~/.bashrc && ~/.local/bin/mise use --global ${pkg}`,
          ]);
        }

        await execa('limactl', ['stop', templateVMName]);

        // Save to index
        templateIndex = addTemplate(templateIndex, {
          name: `template-${packageHash}`,
          hash: packageHash,
          packages,
          created: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          usageCount: 1,
        });
        await saveTemplateIndex(templateIndex);
      }
    }
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 3: Create sandbox VM from template
    const sandboxVMName = getSandboxVMName(name);
    await execa('limactl', ['copy', templateVMName, sandboxVMName]);
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 4: Configure sandbox
    await limaStart(sandboxVMName);

    // Set environment variables
    if (options.gitUser && options.gitToken) {
      await limaExec(sandboxVMName, [
        'sudo',
        '-u',
        'agent_dev',
        'git',
        'config',
        '--global',
        'credential.helper',
        'store',
      ]);
    }
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 5: Clone repository
    await limaExec(sandboxVMName, [
      'sudo',
      '-u',
      'agent_dev',
      'bash',
      '-c',
      `cd ~/workspace && git clone ${repo} .`,
    ]);
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Step 6: Start Claude Code
    await limaExec(sandboxVMName, [
      'sudo',
      '-u',
      'agent_dev',
      '/home/agent_dev/bin/start-claude.sh',
    ]);
    nextTask();
    rerender(<CreateUI tasks={tasks} />);

    // Save sandbox config
    const sandboxConfig: SandboxConfig = {
      name,
      repo,
      branch: 'main',
      packages,
      preset: options.preset,
      vm: {
        cpus: options.cpus ? parseInt(options.cpus) : config.vm.cpus,
        memory: options.memory || config.vm.memory,
        disk: options.disk || config.vm.disk,
      },
      created: new Date().toISOString(),
    };
    await saveSandboxConfig(sandboxConfig);

    unmount();
    render(
      <StatusLine status="success" message={`Created sandbox "${name}"`} />
    );
  } catch (error) {
    updateTask('failed');
    rerender(<CreateUI tasks={tasks} error={String(error)} />);
    unmount();
    process.exit(1);
  }
}
```

**Step 2: Register command**

Add to `src/index.tsx`:

```typescript
import { createCommand } from './commands/create.js';

// ... after program definition

program
  .command('create <name>')
  .description('Create a new sandbox')
  .option('--repo <url>', 'Git repository URL')
  .option('--git-user <user>', 'Git username')
  .option('--git-token <token>', 'Git personal access token')
  .option('--preset <name>', 'Use a preset')
  .option('--packages <list>', 'Comma-separated packages')
  .option('--cpus <n>', 'CPU cores')
  .option('--memory <size>', 'Memory size')
  .option('--disk <size>', 'Disk size')
  .action(createCommand);
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add src/commands/create.tsx src/index.tsx
git commit -m "feat: add create command"
```

---

### Task 15: Start/Stop/Destroy Commands

**Files:**
- Create: `src/commands/start.tsx`
- Create: `src/commands/stop.tsx`
- Create: `src/commands/destroy.tsx`
- Modify: `src/index.tsx`

**Step 1: Implement start command**

Create `src/commands/start.tsx`:

```typescript
import React from 'react';
import { render } from 'ink';
import { sandboxExists } from '../lib/sandbox.js';
import { limaStart, limaList, getSandboxVMName, limaExec } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function startCommand(name: string): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const vmName = getSandboxVMName(name);
  const vms = await limaList();
  const vm = vms.find((v) => v.name === vmName);

  if (vm?.status === 'Running') {
    render(<StatusLine status="info" message={`Sandbox "${name}" is already running`} />);
    return;
  }

  const { rerender, unmount } = render(
    <Spinner message={`Starting sandbox "${name}"...`} />
  );

  try {
    await limaStart(vmName);
    // Start Claude Code session
    await limaExec(vmName, [
      'sudo',
      '-u',
      'agent_dev',
      '/home/agent_dev/bin/start-claude.sh',
    ]);
    unmount();
    render(<StatusLine status="success" message={`Started sandbox "${name}"`} />);
  } catch (error) {
    unmount();
    render(<StatusLine status="error" message={`Failed to start: ${error}`} />);
    process.exit(1);
  }
}
```

**Step 2: Implement stop command**

Create `src/commands/stop.tsx`:

```typescript
import React from 'react';
import { render } from 'ink';
import { sandboxExists } from '../lib/sandbox.js';
import { limaStop, limaList, getSandboxVMName } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function stopCommand(name: string): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const vmName = getSandboxVMName(name);
  const vms = await limaList();
  const vm = vms.find((v) => v.name === vmName);

  if (vm?.status !== 'Running') {
    render(<StatusLine status="info" message={`Sandbox "${name}" is already stopped`} />);
    return;
  }

  const { rerender, unmount } = render(
    <Spinner message={`Stopping sandbox "${name}"...`} />
  );

  try {
    await limaStop(vmName);
    unmount();
    render(<StatusLine status="success" message={`Stopped sandbox "${name}"`} />);
  } catch (error) {
    unmount();
    render(<StatusLine status="error" message={`Failed to stop: ${error}`} />);
    process.exit(1);
  }
}
```

**Step 3: Implement destroy command**

Create `src/commands/destroy.tsx`:

```typescript
import React from 'react';
import { render } from 'ink';
import { sandboxExists, deleteSandboxConfig } from '../lib/sandbox.js';
import { limaDelete, getSandboxVMName } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function destroyCommand(name: string): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const { rerender, unmount } = render(
    <Spinner message={`Destroying sandbox "${name}"...`} />
  );

  try {
    const vmName = getSandboxVMName(name);
    await limaDelete(vmName);
    await deleteSandboxConfig(name);
    unmount();
    render(<StatusLine status="success" message={`Destroyed sandbox "${name}"`} />);
  } catch (error) {
    unmount();
    render(<StatusLine status="error" message={`Failed to destroy: ${error}`} />);
    process.exit(1);
  }
}
```

**Step 4: Register commands**

Add to `src/index.tsx`:

```typescript
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { destroyCommand } from './commands/destroy.js';

// ... after create command

program
  .command('start <name>')
  .description('Start a stopped sandbox')
  .action(startCommand);

program
  .command('stop <name>')
  .description('Stop a running sandbox')
  .action(stopCommand);

program
  .command('destroy <name>')
  .description('Delete a sandbox permanently')
  .action(destroyCommand);
```

**Step 5: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 6: Commit**

```bash
git add src/commands/start.tsx src/commands/stop.tsx src/commands/destroy.tsx src/index.tsx
git commit -m "feat: add start, stop, destroy commands"
```

---

### Task 16: Attach/SSH/Exec Commands

**Files:**
- Create: `src/commands/attach.tsx`
- Create: `src/commands/ssh.tsx`
- Create: `src/commands/exec.tsx`
- Modify: `src/index.tsx`

**Step 1: Implement attach command**

Create `src/commands/attach.tsx`:

```typescript
import React from 'react';
import { render } from 'ink';
import { execa } from 'execa';
import { sandboxExists } from '../lib/sandbox.js';
import { limaList, limaStart, getSandboxVMName, limaExec } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function attachCommand(name: string): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const vmName = getSandboxVMName(name);
  const vms = await limaList();
  const vm = vms.find((v) => v.name === vmName);

  // Auto-start if stopped
  if (vm?.status !== 'Running') {
    const { unmount } = render(<Spinner message="Starting sandbox..." />);
    await limaStart(vmName);
    await limaExec(vmName, [
      'sudo',
      '-u',
      'agent_dev',
      '/home/agent_dev/bin/start-claude.sh',
    ]);
    unmount();
  }

  // Attach to tmux session
  await execa(
    'limactl',
    ['shell', vmName, '--', 'sudo', '-u', 'agent_dev', 'tmux', 'attach', '-t', 'claude'],
    { stdio: 'inherit' }
  );
}
```

**Step 2: Implement ssh command**

Create `src/commands/ssh.tsx`:

```typescript
import React from 'react';
import { render } from 'ink';
import { execa } from 'execa';
import { sandboxExists } from '../lib/sandbox.js';
import { limaList, limaStart, getSandboxVMName } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function sshCommand(name: string): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const vmName = getSandboxVMName(name);
  const vms = await limaList();
  const vm = vms.find((v) => v.name === vmName);

  // Auto-start if stopped
  if (vm?.status !== 'Running') {
    const { unmount } = render(<Spinner message="Starting sandbox..." />);
    await limaStart(vmName);
    unmount();
  }

  // SSH as agent_dev
  await execa(
    'limactl',
    ['shell', vmName, '--', 'sudo', '-u', 'agent_dev', '-i'],
    { stdio: 'inherit' }
  );
}
```

**Step 3: Implement exec command**

Create `src/commands/exec.tsx`:

```typescript
import React from 'react';
import { render } from 'ink';
import { execa } from 'execa';
import { sandboxExists } from '../lib/sandbox.js';
import { limaList, limaStart, getSandboxVMName } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';

export async function execCommand(name: string, cmd: string[]): Promise<void> {
  if (!(await sandboxExists(name))) {
    render(<StatusLine status="error" message={`Sandbox "${name}" not found`} />);
    process.exit(1);
  }

  const vmName = getSandboxVMName(name);
  const vms = await limaList();
  const vm = vms.find((v) => v.name === vmName);

  // Auto-start if stopped
  if (vm?.status !== 'Running') {
    const { unmount } = render(<Spinner message="Starting sandbox..." />);
    await limaStart(vmName);
    unmount();
  }

  // Execute command as agent_dev
  const { stdout, stderr } = await execa(
    'limactl',
    ['shell', vmName, '--', 'sudo', '-u', 'agent_dev', 'bash', '-c', cmd.join(' ')],
    { reject: false }
  );

  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}
```

**Step 4: Register commands**

Add to `src/index.tsx`:

```typescript
import { attachCommand } from './commands/attach.js';
import { sshCommand } from './commands/ssh.js';
import { execCommand } from './commands/exec.js';

// ... after destroy command

program
  .command('attach <name>')
  .description('Attach to Claude Code tmux session')
  .action(attachCommand);

program
  .command('ssh <name>')
  .description('SSH into sandbox as agent_dev')
  .action(sshCommand);

program
  .command('exec <name> <cmd...>')
  .description('Execute command in sandbox')
  .action(execCommand);
```

**Step 5: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 6: Commit**

```bash
git add src/commands/attach.tsx src/commands/ssh.tsx src/commands/exec.tsx src/index.tsx
git commit -m "feat: add attach, ssh, exec commands"
```

---

### Task 17: Template Commands

**Files:**
- Create: `src/commands/template.tsx`
- Modify: `src/index.tsx`

**Step 1: Implement template commands**

Create `src/commands/template.tsx`:

```typescript
import React from 'react';
import { render, Text, Box } from 'ink';
import { loadTemplateIndex, saveTemplateIndex } from '../lib/template.js';
import { limaDelete, getTemplateVMName } from '../lib/lima.js';
import { StatusLine } from '../components/StatusLine.js';

export async function templateListCommand(): Promise<void> {
  const index = await loadTemplateIndex();

  if (index.templates.length === 0) {
    render(<Text dimColor>No cached templates. Templates are created when you use packages.</Text>);
    return;
  }

  render(
    <Box flexDirection="column">
      <Box>
        <Box width={20}><Text bold>NAME</Text></Box>
        <Box width={14}><Text bold>HASH</Text></Box>
        <Box width={8}><Text bold>USES</Text></Box>
        <Box><Text bold>PACKAGES</Text></Box>
      </Box>
      {index.templates.map((t) => (
        <Box key={t.hash}>
          <Box width={20}><Text>{t.name}</Text></Box>
          <Box width={14}><Text dimColor>{t.hash}</Text></Box>
          <Box width={8}><Text>{t.usageCount}</Text></Box>
          <Box><Text dimColor>{t.packages.join(', ')}</Text></Box>
        </Box>
      ))}
    </Box>
  );
}

export async function templatePruneCommand(keep: string = '5'): Promise<void> {
  const keepCount = parseInt(keep);
  const index = await loadTemplateIndex();

  if (index.templates.length <= keepCount) {
    render(
      <StatusLine
        status="info"
        message={`Only ${index.templates.length} templates exist. Nothing to prune.`}
      />
    );
    return;
  }

  // Sort by lastUsed, keep most recent
  const sorted = [...index.templates].sort(
    (a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
  );

  const toKeep = sorted.slice(0, keepCount);
  const toDelete = sorted.slice(keepCount);

  // Delete VMs
  for (const template of toDelete) {
    try {
      await limaDelete(getTemplateVMName(template.hash));
    } catch {
      // Ignore if VM doesn't exist
    }
  }

  // Update index
  await saveTemplateIndex({ templates: toKeep });

  render(
    <StatusLine
      status="success"
      message={`Pruned ${toDelete.length} templates. Kept ${toKeep.length}.`}
    />
  );
}
```

**Step 2: Register commands**

Add to `src/index.tsx`:

```typescript
import { templateListCommand, templatePruneCommand } from './commands/template.js';

// ... after core command

const templateCmd = program.command('template').description('Template management');

templateCmd
  .command('list')
  .description('List cached templates')
  .action(templateListCommand);

templateCmd
  .command('prune [n]')
  .description('Keep only n most recent templates (default: 5)')
  .action(templatePruneCommand);
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add src/commands/template.tsx src/index.tsx
git commit -m "feat: add template list and prune commands"
```

---

### Task 18: Preset Commands

**Files:**
- Create: `src/commands/preset.tsx`
- Modify: `src/index.tsx`

**Step 1: Implement preset commands**

Create `src/commands/preset.tsx`:

```typescript
import React from 'react';
import { render, Text, Box } from 'ink';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadPresets, DEFAULT_PRESETS } from '../lib/presets.js';
import { getConfigDir } from '../lib/config.js';
import { StatusLine } from '../components/StatusLine.js';
import type { PresetsFile } from '../lib/types.js';

export async function presetListCommand(): Promise<void> {
  const presets = await loadPresets();

  render(
    <Box flexDirection="column">
      <Box>
        <Box width={20}><Text bold>NAME</Text></Box>
        <Box width={40}><Text bold>DESCRIPTION</Text></Box>
        <Box><Text bold>PACKAGES</Text></Box>
      </Box>
      {Object.entries(presets.presets).map(([name, preset]) => (
        <Box key={name}>
          <Box width={20}><Text>{name}</Text></Box>
          <Box width={40}><Text dimColor>{preset.description}</Text></Box>
          <Box><Text dimColor>{preset.packages.join(', ')}</Text></Box>
        </Box>
      ))}
    </Box>
  );
}

export async function presetCreateCommand(
  name: string,
  packages: string
): Promise<void> {
  const configDir = getConfigDir();
  const presetsPath = join(configDir, 'presets.yml');

  // Load existing user presets
  let userPresets: PresetsFile = { presets: {} };
  try {
    const content = await readFile(presetsPath, 'utf-8');
    userPresets = parseYaml(content) as PresetsFile;
  } catch {
    // File doesn't exist, start fresh
  }

  // Check if preset already exists
  if (userPresets.presets[name] || DEFAULT_PRESETS.presets[name]) {
    render(
      <StatusLine status="error" message={`Preset "${name}" already exists`} />
    );
    process.exit(1);
  }

  // Add new preset
  userPresets.presets[name] = {
    description: `Custom preset: ${packages}`,
    packages: packages.split(',').map((p) => p.trim()),
  };

  // Save
  await mkdir(configDir, { recursive: true });
  await writeFile(presetsPath, stringifyYaml(userPresets));

  render(
    <StatusLine status="success" message={`Created preset "${name}"`} />
  );
}

export async function presetDeleteCommand(name: string): Promise<void> {
  // Can't delete default presets
  if (DEFAULT_PRESETS.presets[name]) {
    render(
      <StatusLine status="error" message={`Cannot delete built-in preset "${name}"`} />
    );
    process.exit(1);
  }

  const configDir = getConfigDir();
  const presetsPath = join(configDir, 'presets.yml');

  let userPresets: PresetsFile;
  try {
    const content = await readFile(presetsPath, 'utf-8');
    userPresets = parseYaml(content) as PresetsFile;
  } catch {
    render(
      <StatusLine status="error" message={`Preset "${name}" not found`} />
    );
    process.exit(1);
  }

  if (!userPresets.presets[name]) {
    render(
      <StatusLine status="error" message={`Preset "${name}" not found`} />
    );
    process.exit(1);
  }

  delete userPresets.presets[name];
  await writeFile(presetsPath, stringifyYaml(userPresets));

  render(
    <StatusLine status="success" message={`Deleted preset "${name}"`} />
  );
}
```

**Step 2: Register commands**

Add to `src/index.tsx`:

```typescript
import {
  presetListCommand,
  presetCreateCommand,
  presetDeleteCommand,
} from './commands/preset.js';

// ... after template command

const presetCmd = program.command('preset').description('Preset management');

presetCmd
  .command('list')
  .description('List available presets')
  .action(presetListCommand);

presetCmd
  .command('create <name> <packages>')
  .description('Create a custom preset')
  .action(presetCreateCommand);

presetCmd
  .command('delete <name>')
  .description('Delete a custom preset')
  .action(presetDeleteCommand);
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add src/commands/preset.tsx src/index.tsx
git commit -m "feat: add preset commands"
```

---

## Phase 6: Shell Completions

### Task 19: Completions Command

**Files:**
- Create: `src/commands/completions.tsx`
- Modify: `src/index.tsx`

**Step 1: Implement completions command**

Create `src/commands/completions.tsx`:

```typescript
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execa } from 'execa';

const BASH_COMPLETION = `
_arig_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "\${prev}" in
    arig)
      COMPREPLY=($(compgen -W "create list info start stop destroy attach ssh exec core template preset completions" -- "\${cur}"))
      return 0
      ;;
    start|stop|destroy|attach|ssh|exec|info)
      local sandboxes=$(arig list 2>/dev/null | tail -n +2 | awk '{print $1}')
      COMPREPLY=($(compgen -W "\${sandboxes}" -- "\${cur}"))
      return 0
      ;;
    --preset)
      local presets=$(arig preset list 2>/dev/null | tail -n +2 | awk '{print $1}')
      COMPREPLY=($(compgen -W "\${presets}" -- "\${cur}"))
      return 0
      ;;
    core)
      COMPREPLY=($(compgen -W "build" -- "\${cur}"))
      return 0
      ;;
    template)
      COMPREPLY=($(compgen -W "list prune" -- "\${cur}"))
      return 0
      ;;
    preset)
      COMPREPLY=($(compgen -W "list create delete" -- "\${cur}"))
      return 0
      ;;
    completions)
      COMPREPLY=($(compgen -W "install bash zsh" -- "\${cur}"))
      return 0
      ;;
  esac
}
complete -F _arig_completions arig
`;

const ZSH_COMPLETION = `
#compdef arig

_arig() {
  local -a commands sandboxes presets

  commands=(
    'create:Create a new sandbox'
    'list:List all sandboxes'
    'info:Show sandbox info'
    'start:Start a sandbox'
    'stop:Stop a sandbox'
    'destroy:Delete a sandbox'
    'attach:Attach to Claude session'
    'ssh:SSH into sandbox'
    'exec:Execute command'
    'core:Core template management'
    'template:Template management'
    'preset:Preset management'
    'completions:Shell completions'
  )

  _arguments -C \\
    '1: :->command' \\
    '*: :->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case $words[2] in
        start|stop|destroy|attach|ssh|exec|info)
          sandboxes=(\${(f)"$(arig list 2>/dev/null | tail -n +2 | awk '{print $1}')"})
          _describe 'sandbox' sandboxes
          ;;
        create)
          _arguments \\
            '--repo[Git repository URL]:url:' \\
            '--preset[Use preset]:preset:->presets' \\
            '--packages[Packages]:packages:' \\
            '--cpus[CPU cores]:cpus:' \\
            '--memory[Memory]:memory:' \\
            '--disk[Disk size]:disk:'
          ;;
      esac
      ;;
  esac
}

_arig
`;

export async function completionsBashCommand(): Promise<void> {
  console.log(BASH_COMPLETION);
}

export async function completionsZshCommand(): Promise<void> {
  console.log(ZSH_COMPLETION);
}

export async function completionsInstallCommand(): Promise<void> {
  const shell = process.env.SHELL || '/bin/bash';

  if (shell.includes('zsh')) {
    const completionDir = join(homedir(), '.zsh', 'completions');
    const completionFile = join(completionDir, '_arig');
    await writeFile(completionFile, ZSH_COMPLETION);
    console.log(`Installed zsh completions to ${completionFile}`);
    console.log('Add to your .zshrc: fpath=(~/.zsh/completions $fpath)');
  } else {
    const completionFile = join(homedir(), '.bash_completion.d', 'arig');
    await writeFile(completionFile, BASH_COMPLETION);
    console.log(`Installed bash completions to ${completionFile}`);
    console.log('Add to your .bashrc: source ~/.bash_completion.d/arig');
  }
}
```

**Step 2: Register commands**

Add to `src/index.tsx`:

```typescript
import {
  completionsBashCommand,
  completionsZshCommand,
  completionsInstallCommand,
} from './commands/completions.js';

// ... after preset command

const completionsCmd = program.command('completions').description('Shell completions');

completionsCmd
  .command('install')
  .description('Install shell completions')
  .action(completionsInstallCommand);

completionsCmd
  .command('bash')
  .description('Output bash completions')
  .action(completionsBashCommand);

completionsCmd
  .command('zsh')
  .description('Output zsh completions')
  .action(completionsZshCommand);
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add src/commands/completions.tsx src/index.tsx
git commit -m "feat: add shell completions"
```

---

## Phase 7: Final Integration

### Task 20: Final Index Assembly

**Files:**
- Modify: `src/index.tsx`

**Step 1: Verify complete index.tsx**

Ensure `src/index.tsx` has all imports and commands registered:

```typescript
#!/usr/bin/env node
import { program } from 'commander';
import { listCommand } from './commands/list.js';
import { infoCommand } from './commands/info.js';
import { createCommand } from './commands/create.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { destroyCommand } from './commands/destroy.js';
import { attachCommand } from './commands/attach.js';
import { sshCommand } from './commands/ssh.js';
import { execCommand } from './commands/exec.js';
import { coreBuildCommand } from './commands/core.js';
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

program
  .name('arig')
  .description('CLI tool for creating isolated development environments for coding agents')
  .version('0.1.0');

// Sandbox lifecycle
program
  .command('create <name>')
  .description('Create a new sandbox')
  .option('--repo <url>', 'Git repository URL')
  .option('--git-user <user>', 'Git username')
  .option('--git-token <token>', 'Git personal access token')
  .option('--preset <name>', 'Use a preset')
  .option('--packages <list>', 'Comma-separated packages')
  .option('--cpus <n>', 'CPU cores')
  .option('--memory <size>', 'Memory size')
  .option('--disk <size>', 'Disk size')
  .action(createCommand);

program
  .command('list')
  .alias('ls')
  .description('List all sandboxes with status')
  .action(listCommand);

program
  .command('info <name>')
  .description('Show detailed sandbox info')
  .action(infoCommand);

program
  .command('start <name>')
  .description('Start a stopped sandbox')
  .action(startCommand);

program
  .command('stop <name>')
  .description('Stop a running sandbox')
  .action(stopCommand);

program
  .command('destroy <name>')
  .description('Delete a sandbox permanently')
  .action(destroyCommand);

// Interaction
program
  .command('attach <name>')
  .description('Attach to Claude Code tmux session')
  .action(attachCommand);

program
  .command('ssh <name>')
  .description('SSH into sandbox as agent_dev')
  .action(sshCommand);

program
  .command('exec <name> <cmd...>')
  .description('Execute command in sandbox')
  .action(execCommand);

// Core template
const coreCmd = program.command('core').description('Core template management');
coreCmd
  .command('build')
  .description('Build/rebuild core template')
  .option('-f, --force', 'Force rebuild even if exists')
  .action(coreBuildCommand);

// Templates
const templateCmd = program.command('template').description('Template management');
templateCmd
  .command('list')
  .description('List cached templates')
  .action(templateListCommand);
templateCmd
  .command('prune [n]')
  .description('Keep only n most recent templates (default: 5)')
  .action(templatePruneCommand);

// Presets
const presetCmd = program.command('preset').description('Preset management');
presetCmd
  .command('list')
  .description('List available presets')
  .action(presetListCommand);
presetCmd
  .command('create <name> <packages>')
  .description('Create a custom preset')
  .action(presetCreateCommand);
presetCmd
  .command('delete <name>')
  .description('Delete a custom preset')
  .action(presetDeleteCommand);

// Completions
const completionsCmd = program.command('completions').description('Shell completions');
completionsCmd
  .command('install')
  .description('Install shell completions')
  .action(completionsInstallCommand);
completionsCmd
  .command('bash')
  .description('Output bash completions')
  .action(completionsBashCommand);
completionsCmd
  .command('zsh')
  .description('Output zsh completions')
  .action(completionsZshCommand);

program.parse();
```

**Step 2: Build final version**

Run: `npm run build`
Expected: Compiles without errors

**Step 3: Run all tests**

Run: `npm run test:run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/index.tsx
git commit -m "feat: complete CLI with all commands"
```

---

### Task 21: Add Package Scripts and Bin Entry

**Files:**
- Modify: `package.json`

**Step 1: Verify package.json bin entry**

Ensure `package.json` has correct bin configuration:

```json
{
  "bin": {
    "arig": "./dist/index.js"
  }
}
```

**Step 2: Add shebang to built output**

The `#!/usr/bin/env node` is already in `src/index.tsx`, so it will be in the compiled output.

**Step 3: Test local installation**

Run: `npm link`
Expected: Creates global symlink

Run: `arig --help`
Expected: Shows help with all commands

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: finalize package configuration"
```

---

### Task 22: Copy Package Definitions

**Files:**
- Copy: `reftemp/agent-sandbox/packages/*` → `packages/`

**Step 1: Copy package definitions**

```bash
cp -r reftemp/agent-sandbox/packages packages/
```

**Step 2: Commit**

```bash
git add packages/
git commit -m "feat: add package definitions for mise"
```

---

### Task 23: Add Default Config Files

**Files:**
- Create: `config.yml`
- Create: `presets.yml`

**Step 1: Create default config.yml**

```yaml
# Agent Rig Global Configuration

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

**Step 2: Create default presets.yml**

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

**Step 3: Commit**

```bash
git add config.yml presets.yml
git commit -m "feat: add default configuration files"
```

---

## Summary

This plan implements the agent-rig CLI in 23 tasks across 7 phases:

1. **Phase 1: Project Foundation** (Tasks 1-2) - Initialize TypeScript project
2. **Phase 2: Core Library - Configuration** (Tasks 3-5) - Config, presets, templates
3. **Phase 3: Lima Integration** (Tasks 6-7) - Lima wrapper and sandbox management
4. **Phase 4: UI Components** (Tasks 8-10) - Spinner, TaskList, StatusLine
5. **Phase 5: Commands** (Tasks 11-18) - All CLI commands
6. **Phase 6: Shell Completions** (Task 19) - Bash/Zsh completions
7. **Phase 7: Final Integration** (Tasks 20-23) - Assembly and config files

Each task follows TDD with explicit test-first steps, exact file paths, and commit points.
