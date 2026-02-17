import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  constants: { F_OK: 0 },
}));

vi.mock('../version.js', () => ({
  VERSION: '1.2.3',
}));

vi.mock('../lib/config.js', () => ({
  getConfigDir: vi.fn().mockReturnValue('/home/user/.config/arig'),
}));

vi.mock('../lib/sudoers-template.js', () => ({
  ROOT_HELPER_PATH: '/usr/local/libexec/arigd-root-helper',
  SUDOERS_DROP_IN_PATH: '/etc/sudoers.d/arigd-root-helper',
  ARIG_GROUP: 'arig',
}));

import { execa } from 'execa';
import { access } from 'node:fs/promises';
import { diagnoseCommand } from './diagnose.js';

const mockExeca = vi.mocked(execa);
const mockAccess = vi.mocked(access);

describe('diagnoseCommand', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  /** Set up mocks so all checks pass. */
  function mockAllPassing() {
    // fileExists: all files exist
    mockAccess.mockResolvedValue(undefined);
    // commandExists (which): all commands found
    // id -nG: user is in arig group
    mockExeca.mockImplementation((cmd: string, args?: readonly string[]) => {
      if (cmd === 'which') {
        return { stdout: `/usr/bin/${args?.[0]}`, exitCode: 0 } as any;
      }
      if (cmd === 'id') {
        return { stdout: 'user arig docker', exitCode: 0 } as any;
      }
      return { stdout: '', exitCode: 0 } as any;
    });
  }

  it('prints header and section titles', async () => {
    mockAllPassing();
    await diagnoseCommand();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('arig diagnostics');
    expect(output).toContain('System');
    expect(output).toContain('Permissions (Linux)');
    expect(output).toContain('Dependencies');
  });

  it('reports version from VERSION constant', async () => {
    mockAllPassing();
    await diagnoseCommand();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('1.2.3');
  });

  it('reports all checks passed when everything is ok', async () => {
    mockAllPassing();
    await diagnoseCommand();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('All checks passed');
    expect(process.exitCode).toBeUndefined();
  });

  it('sets exitCode 1 when a check fails', async () => {
    // fileExists: all files missing
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockExeca.mockImplementation((cmd: string) => {
      if (cmd === 'which') {
        throw new Error('not found');
      }
      if (cmd === 'id') {
        return { stdout: 'user', exitCode: 0 } as any;
      }
      return { stdout: '', exitCode: 0 } as any;
    });

    await diagnoseCommand();

    expect(process.exitCode).toBe(1);
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('issue(s) found');
  });

  it('reports warnings for missing config dir', async () => {
    // Config dir missing, but other files exist
    mockAccess.mockImplementation(async (path: any) => {
      if (path === '/home/user/.config/arig') {
        throw new Error('ENOENT');
      }
      return undefined;
    });
    mockExeca.mockImplementation((cmd: string, args?: readonly string[]) => {
      if (cmd === 'which') {
        return { stdout: `/usr/bin/${args?.[0]}`, exitCode: 0 } as any;
      }
      if (cmd === 'id') {
        return { stdout: 'user arig', exitCode: 0 } as any;
      }
      return { stdout: '', exitCode: 0 } as any;
    });

    await diagnoseCommand();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[WARN]');
    expect(output).toContain('not found');
  });

  it('reports group membership warning when user not in arig group', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockExeca.mockImplementation((cmd: string, args?: readonly string[]) => {
      if (cmd === 'which') {
        return { stdout: `/usr/bin/${args?.[0]}`, exitCode: 0 } as any;
      }
      if (cmd === 'id') {
        return { stdout: 'user docker', exitCode: 0 } as any;
      }
      return { stdout: '', exitCode: 0 } as any;
    });

    await diagnoseCommand();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('NOT a member');
  });

  it('reports root helper and sudoers as FAIL when missing', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockExeca.mockImplementation((cmd: string, args?: readonly string[]) => {
      if (cmd === 'which') {
        return { stdout: `/usr/bin/${args?.[0]}`, exitCode: 0 } as any;
      }
      if (cmd === 'id') {
        return { stdout: 'user arig', exitCode: 0 } as any;
      }
      return { stdout: '', exitCode: 0 } as any;
    });

    await diagnoseCommand();

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('[FAIL]');
    expect(output).toContain('sudo arig setup');
  });
});
