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
