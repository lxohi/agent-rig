export interface VMConfig {
  cpus: number;
  memory: string;
  disk: string;
}

export interface ClaudeConfig {
  baseUrl?: string;
  authToken?: string;
}

export interface LimitsConfig {
  memory_max: string;
  cpu_quota: string;
  tasks_max: number;
}

export interface GitConfig {
  user?: string;
  email?: string;
}

export interface Config {
  vm: VMConfig;
  claude: ClaudeConfig;
  limits: LimitsConfig;
  git: GitConfig;
}

export interface PortMapping {
  id: string;
  hostPort: number;
  targetPort: number;
  protocol: 'tcp' | 'udp';
  bindAddress: string;
  status: 'active' | 'pending' | 'error';
  createdAt: string;
  lastError?: string;
}

export interface SandboxRuntime {
  driver: 'linux-rootless' | 'macos-sharedvm-rootless';
  sandboxId: string;
  sandboxUser: string;
  stateVersion: string;
}

export interface SandboxConfig {
  name: string;
  repo: string;
  branch: string;
  packages: string[];
  preset?: string;
  vm?: VMConfig;
  git?: {
    user?: string;
    token?: string;
    name?: string;
    email?: string;
  };
  claude?: ClaudeConfig;
  created: string;
  runtime?: SandboxRuntime;
  tools?: string[];
  ports?: PortMapping[];
}

export interface TemplateEntry {
  name: string;
  hash: string;
  packages: string[];
  created: string;
  lastUsed: string;
  usageCount: number;
  scriptHash?: string;
  runtimeVersion?: string;
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
