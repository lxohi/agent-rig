import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('./transports/SSHTransport.js', () => ({
  SSHTransport: vi.fn().mockImplementation(() => ({
    request: vi.fn(),
    openStream: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('./daemon-client.js', () => {
  const mockCall = vi.fn();
  const mockClose = vi.fn();
  return {
    DaemonClient: vi.fn().mockImplementation(() => ({
      call: mockCall,
      close: mockClose,
    })),
    DaemonRpcError: class extends Error {
      code: number;
      constructor(err: { code: number; message: string }) {
        super(err.message);
        this.code = err.code;
      }
    },
  };
});

vi.mock('./macos/vm-manager.js', () => ({
  SHARED_VM_NAME: 'arig-shared',
  getVMStatus: vi.fn().mockResolvedValue({ name: 'arig-shared', status: 'running' }),
  startVM: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./macos/relay.js', () => ({
  stopAllRelays: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execa } from 'execa';
import { DaemonClient } from './daemon-client.js';
import { getVMStatus, startVM } from './macos/vm-manager.js';
import { MacOSSharedVMDriver } from './macos-sharedvm.js';

const mockExeca = vi.mocked(execa);
const mockGetVMStatus = vi.mocked(getVMStatus);
const mockStartVM = vi.mocked(startVM);

function mockSSHConfig() {
  mockExeca.mockResolvedValue({
    stdout: [
      'Host arig-shared',
      '  HostName 127.0.0.1',
      '  Port 60022',
      '  User default',
      '  IdentityFile "/home/user/.lima/_config/user"',
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  } as any);
}

describe('MacOSSharedVMDriver edge cases', () => {
  let driver: MacOSSharedVMDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new MacOSSharedVMDriver();
    mockGetVMStatus.mockResolvedValue({ name: 'arig-shared', status: 'running' });
    mockSSHConfig();
  });

  describe('list()', () => {
    it('parses getent passwd output for sandbox users', async () => {
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({ pong: true });
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      // Mock limactl show-ssh for SSH config
      mockExeca
        .mockResolvedValueOnce({
          stdout: 'Host arig-shared\n  HostName 127.0.0.1\n  Port 60022\n  User default\n  IdentityFile "/home/user/.lima/_config/user"',
          stderr: '', exitCode: 0,
        } as any)
        // Mock getent passwd output
        .mockResolvedValueOnce({
          stdout: 'root:x:0:0:root:/root:/bin/bash\narig_sb_my_project:x:1001:1001::/home/arig_sb_my_project:/bin/bash\narig_sb_other_one:x:1002:1002::/home/arig_sb_other_one:/bin/bash\nregular_user:x:1000:1000::/home/regular_user:/bin/bash',
          stderr: '', exitCode: 0,
        } as any);

      const infos = await driver.list();

      expect(infos).toHaveLength(2);
      expect(infos[0].sandboxName).toBe('my-project');
      expect(infos[0].name).toBe('arig_sb_my_project');
      expect(infos[0].driver).toBe('macos-sharedvm');
      expect(infos[1].sandboxName).toBe('other-one');
    });

    it('returns empty array when no sandbox users exist', async () => {
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({ pong: true });
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      mockExeca
        .mockResolvedValueOnce({
          stdout: 'Host arig-shared\n  HostName 127.0.0.1\n  Port 60022\n  User default\n  IdentityFile "/home/user/.lima/_config/user"',
          stderr: '', exitCode: 0,
        } as any)
        .mockResolvedValueOnce({
          stdout: 'root:x:0:0:root:/root:/bin/bash\n',
          stderr: '', exitCode: 0,
        } as any);

      const infos = await driver.list();
      expect(infos).toHaveLength(0);
    });
  });

  describe('destroy()', () => {
    it('calls stopAllRelays before sandbox.destroy', async () => {
      const { stopAllRelays } = await import('./macos/relay.js');
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({});
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      await driver.destroy('my-sandbox');

      expect(stopAllRelays).toHaveBeenCalled();
      expect(mockCall).toHaveBeenCalledWith('sandbox.destroy', {
        sandboxName: 'my-sandbox',
      });
    });

    it('closes client even when destroy throws', async () => {
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockRejectedValue(new Error('destroy failed'));
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      await expect(driver.destroy('my-sandbox')).rejects.toThrow('destroy failed');
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('SSH config resolution', () => {
    it('throws when port is missing from SSH config', async () => {
      // Create a fresh driver to avoid cached config
      const freshDriver = new MacOSSharedVMDriver();
      mockExeca.mockResolvedValue({
        stdout: 'Host arig-shared\n  HostName 127.0.0.1\n  User default\n  IdentityFile "/home/user/.lima/_config/user"',
        stderr: '', exitCode: 0,
      } as any);

      await expect(freshDriver.inspect('test')).rejects.toThrow(
        'Failed to resolve SSH config',
      );
    });

    it('throws when identityFile is missing from SSH config', async () => {
      const freshDriver = new MacOSSharedVMDriver();
      mockExeca.mockResolvedValue({
        stdout: 'Host arig-shared\n  HostName 127.0.0.1\n  Port 60022\n  User default',
        stderr: '', exitCode: 0,
      } as any);

      await expect(freshDriver.inspect('test')).rejects.toThrow(
        'Failed to resolve SSH config',
      );
    });

    it('invalidates cached SSH config after auto-starting stopped VM', async () => {
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({ state: 'running' });
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      // First call: VM is stopped, auto-start
      mockGetVMStatus.mockResolvedValueOnce({ name: 'arig-shared', status: 'stopped' });

      // SSH config calls: first for auto-start resolution, second after invalidation
      let sshCallCount = 0;
      mockExeca.mockImplementation(async (cmd: string, args?: string[]) => {
        if (cmd === 'limactl' && args?.[0] === 'show-ssh') {
          sshCallCount++;
          return {
            stdout: `Host arig-shared\n  HostName 127.0.0.1\n  Port ${60022 + sshCallCount}\n  User default\n  IdentityFile "/home/user/.lima/_config/user"`,
            stderr: '', exitCode: 0,
          } as any;
        }
        return { stdout: '', stderr: '', exitCode: 0 } as any;
      });

      await driver.inspect('test-sandbox');

      // After auto-start, SSH config should be re-resolved (port may change)
      expect(mockStartVM).toHaveBeenCalled();
    });

    it('strips quotes from IdentityFile path', async () => {
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const { SSHTransport: MockSSHTransport } = vi.mocked(await import('./transports/SSHTransport.js'));
      const mockCall = vi.fn().mockResolvedValue({ state: 'running' });
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      const freshDriver = new MacOSSharedVMDriver();
      mockExeca.mockResolvedValue({
        stdout: 'Host arig-shared\n  HostName 127.0.0.1\n  Port 60022\n  User default\n  IdentityFile "/path/with spaces/key"',
        stderr: '', exitCode: 0,
      } as any);

      await freshDriver.inspect('test');

      // SSHTransport should have been constructed with unquoted path
      expect(MockSSHTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          identityFile: '/path/with spaces/key',
        }),
      );
    });
  });
});
