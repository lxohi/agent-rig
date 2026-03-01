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

vi.mock('./macos/bootstrap.js', () => ({
  runtimeInit: vi.fn().mockResolvedValue(undefined),
  runtimeStatus: vi.fn(),
}));

vi.mock('../logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execa } from 'execa';
import { DaemonClient, DaemonRpcError } from './daemon-client.js';
import { getVMStatus, startVM } from './macos/vm-manager.js';
import { MacOSSharedVMDriver } from './macos-sharedvm.js';

const mockExeca = vi.mocked(execa);
const mockGetVMStatus = vi.mocked(getVMStatus);
const mockStartVM = vi.mocked(startVM);

/** Helper to get the mock call/close from the last DaemonClient instance. */
function getClientMocks() {
  const MockDaemonClient = vi.mocked(DaemonClient);
  const lastInstance = MockDaemonClient.mock.results.at(-1)?.value;
  return {
    call: lastInstance?.call as ReturnType<typeof vi.fn>,
    close: lastInstance?.close as ReturnType<typeof vi.fn>,
  };
}

/** Set up execa mock to return SSH config from limactl show-ssh. */
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

describe('MacOSSharedVMDriver', () => {
  let driver: MacOSSharedVMDriver;

  beforeEach(() => {
    vi.clearAllMocks();
    driver = new MacOSSharedVMDriver();
    mockGetVMStatus.mockResolvedValue({ name: 'arig-shared', status: 'running' });
    mockSSHConfig();
  });

  describe('ensureVMRunning', () => {
    it('does nothing when VM is already running', async () => {
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({ state: 'running' });
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      await driver.inspect('test-sandbox');

      expect(mockStartVM).not.toHaveBeenCalled();
    });

    it('auto-starts stopped VM', async () => {
      mockGetVMStatus.mockResolvedValueOnce({ name: 'arig-shared', status: 'stopped' });

      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({ state: 'running' });
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      await driver.inspect('test-sandbox');

      expect(mockStartVM).toHaveBeenCalled();
    });

    it('auto-initializes when VM is not found', async () => {
      mockGetVMStatus.mockResolvedValueOnce({ name: 'arig-shared', status: 'not_found' });

      const { runtimeInit } = vi.mocked(await import('./macos/bootstrap.js'));
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({ state: 'running' });
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      await driver.inspect('test-sandbox');

      expect(runtimeInit).toHaveBeenCalled();
    });

    it('throws when VM is broken', async () => {
      mockGetVMStatus.mockResolvedValueOnce({ name: 'arig-shared', status: 'broken' });

      await expect(driver.inspect('test-sandbox')).rejects.toThrow(
        'Run "arig runtime repair"',
      );
    });
  });

  describe('inspect()', () => {
    it('returns sandbox info from arigd', async () => {
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({
        state: 'running',
        pid: 1234,
        ports: [],
        startedAt: '2026-02-08T00:00:00Z',
      });
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      const info = await driver.inspect('my-project');

      expect(info).toEqual({
        name: 'arig_sb_my_project',
        sandboxName: 'my-project',
        state: 'running',
        driver: 'macos-sharedvm',
        meta: {
          pid: 1234,
          ports: [],
          startedAt: '2026-02-08T00:00:00Z',
        },
      });
      expect(mockCall).toHaveBeenCalledWith('sandbox.inspect', { sandboxName: 'my-project' });
      expect(mockClose).toHaveBeenCalled();
    });

    it('returns undefined for non-existent sandbox (code 1001)', async () => {
      const { DaemonClient: MockClient, DaemonRpcError: MockError } =
        vi.mocked(await import('./daemon-client.js'));
      const err = new MockError({ code: 1001, message: 'not found' });
      const mockCall = vi.fn().mockRejectedValue(err);
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      const info = await driver.inspect('nonexistent');
      expect(info).toBeUndefined();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('create()', () => {
    it('calls sandbox.create via DaemonClient', async () => {
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({ sandboxId: 'sb_123' });
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      await driver.create('new-sandbox');

      expect(mockCall).toHaveBeenCalledWith('sandbox.create', {
        sandboxName: 'new-sandbox',
        config: undefined,
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('start()', () => {
    it('calls sandbox.start via DaemonClient', async () => {
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({});
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      await driver.start('my-sandbox');

      expect(mockCall).toHaveBeenCalledWith('sandbox.start', {
        sandboxName: 'my-sandbox',
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    it('calls sandbox.stop via DaemonClient', async () => {
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({});
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      await driver.stop('my-sandbox');

      expect(mockCall).toHaveBeenCalledWith('sandbox.stop', {
        sandboxName: 'my-sandbox',
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('execRun()', () => {
    it('calls sandbox.exec.run and returns result', async () => {
      const { DaemonClient: MockClient } = vi.mocked(await import('./daemon-client.js'));
      const mockCall = vi.fn().mockResolvedValue({
        stdout: 'hello world',
        stderr: '',
        exitCode: 0,
      });
      const mockClose = vi.fn();
      MockClient.mockImplementation(() => ({ call: mockCall, close: mockClose }) as any);

      const result = await driver.execRun('my-sandbox', ['echo', 'hello world']);

      expect(result).toEqual({
        stdout: 'hello world',
        stderr: '',
        exitCode: 0,
      });
      expect(mockCall).toHaveBeenCalledWith('sandbox.exec.run', {
        sandboxName: 'my-sandbox',
        command: ['echo', 'hello world'],
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('driver metadata', () => {
    it('has name "macos-sharedvm"', () => {
      expect(driver.name).toBe('macos-sharedvm');
    });
  });
});
