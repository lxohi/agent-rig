import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import { SSHTransport } from './SSHTransport.js';

const mockExeca = vi.mocked(execa);

const defaultOpts = {
  host: '127.0.0.1',
  port: 60022,
  user: 'default',
  identityFile: '/home/user/.lima/_config/user',
  remoteSocketPath: '/run/arig/arigd.sock',
  strictHostKeyChecking: false,
};

describe('SSHTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('request()', () => {
    it('sends JSON-RPC payload via SSH and parses response', async () => {
      const transport = new SSHTransport(defaultOpts);
      const response = { jsonrpc: '2.0', id: 1, result: { pong: true } };

      mockExeca.mockResolvedValue({
        stdout: JSON.stringify(response) + '\n',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await transport.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'runtime.ping',
        params: {},
      });

      expect(result).toEqual(response);
      expect(mockExeca).toHaveBeenCalledWith('ssh', expect.arrayContaining([
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'BatchMode=yes',
        '-i', defaultOpts.identityFile,
        '-p', '60022',
        `${defaultOpts.user}@${defaultOpts.host}`,
      ]), expect.any(Object));
    });

    it('rejects on SSH failure with no stdout', async () => {
      const transport = new SSHTransport(defaultOpts);

      mockExeca.mockResolvedValue({
        stdout: '',
        stderr: 'Connection refused',
        exitCode: 255,
      } as any);

      await expect(
        transport.request({ jsonrpc: '2.0', id: 1, method: 'runtime.ping' }),
      ).rejects.toThrow('SSH command failed');
    });

    it('rejects on invalid JSON response', async () => {
      const transport = new SSHTransport(defaultOpts);

      mockExeca.mockResolvedValue({
        stdout: 'not-json\n',
        stderr: '',
        exitCode: 0,
      } as any);

      await expect(
        transport.request({ jsonrpc: '2.0', id: 1, method: 'runtime.ping' }),
      ).rejects.toThrow('Invalid JSON response');
    });

    it('rejects on empty response', async () => {
      const transport = new SSHTransport(defaultOpts);

      mockExeca.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any);

      await expect(
        transport.request({ jsonrpc: '2.0', id: 1, method: 'runtime.ping' }),
      ).rejects.toThrow('Empty response');
    });

    it('parses only the first JSON line from multi-line output', async () => {
      const transport = new SSHTransport(defaultOpts);
      const response = { jsonrpc: '2.0', id: 1, result: { pong: true } };

      mockExeca.mockResolvedValue({
        stdout: JSON.stringify(response) + '\nextra line\n',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await transport.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'runtime.ping',
      });

      expect(result).toEqual(response);
    });

    it('uses strict host key checking when enabled', async () => {
      const transport = new SSHTransport({
        ...defaultOpts,
        strictHostKeyChecking: undefined,
      });

      mockExeca.mockResolvedValue({
        stdout: '{"jsonrpc":"2.0","id":1,"result":{}}\n',
        stderr: '',
        exitCode: 0,
      } as any);

      await transport.request({ jsonrpc: '2.0', id: 1, method: 'runtime.ping' });

      expect(mockExeca).toHaveBeenCalledWith('ssh', expect.arrayContaining([
        '-o', 'StrictHostKeyChecking=yes',
      ]), expect.any(Object));
    });
  });

  describe('openStream()', () => {
    it('rejects unsupported transport types', async () => {
      const transport = new SSHTransport(defaultOpts);

      await expect(
        transport.openStream({
          transport: 'websocket' as any,
          path: '/tmp/session.sock',
          token: 'abc',
        }),
      ).rejects.toThrow('SSHTransport cannot handle transport: websocket');
    });
  });

  describe('close()', () => {
    it('resolves without error (stateless)', async () => {
      const transport = new SSHTransport(defaultOpts);
      await expect(transport.close()).resolves.toBeUndefined();
    });
  });
});
