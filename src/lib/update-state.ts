import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface UpdateState {
  currentVersion: string;
  lastCheck: string | null;
  pendingVersion: string | null;
  pendingPath: string | null;
  downloadStarted: string | null;
  downloadPid: number | null;
}

const DEFAULT_STATE: UpdateState = {
  currentVersion: '0.0.0',
  lastCheck: null,
  pendingVersion: null,
  pendingPath: null,
  downloadStarted: null,
  downloadPid: null,
};

export function getInstallDir(): string {
  return process.env.ARIG_INSTALL_DIR || join(homedir(), '.arig');
}

export async function loadUpdateState(installDir?: string): Promise<UpdateState> {
  const dir = installDir || getInstallDir();
  const statePath = join(dir, 'update.json');

  try {
    const content = await readFile(statePath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<UpdateState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_STATE;
    }
    throw error;
  }
}

export async function saveUpdateState(state: UpdateState, installDir?: string): Promise<void> {
  const dir = installDir || getInstallDir();
  const statePath = join(dir, 'update.json');
  await writeFile(statePath, JSON.stringify(state, null, 2));
}
