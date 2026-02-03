import { execa } from 'execa';
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
  if (!output.trim()) {
    return [];
  }

  // limactl list --json outputs NDJSON (one JSON object per line)
  const lines = output.trim().split('\n');
  const vms: LimaVM[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') {
        vms.push(parsed as LimaVM);
      }
    } catch {
      // Skip invalid lines
    }
  }

  return vms;
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
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
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
  await execa('limactl', ['clone', sourceName, targetName]);
}

export function getSandboxVMName(sandboxName: string): string {
  return `arig-${sandboxName}`;
}

export function getTemplateVMName(hash: string): string {
  return hash ? `arig-template-${hash}` : 'arig-core';
}
