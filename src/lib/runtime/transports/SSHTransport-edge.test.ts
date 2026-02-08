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

describe('SSHTransport edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('request()', () => {
    it('includes correct socat remote command with socket path', async () => {
      const transport = new SSHTransport(defaultOpts);
      const response = { jsonrpc: '2.0', id: 1, result: {} };

      mockExeca.mockResolvedValue({
        stdout: JSON.stringify(response),
        stderr: '', exitCode: 0,
      } as any);

      await transport.request({
        jsonrpc: '2.0', id: 1, method: 'test',
      });

      const args = mockExeca.mock.calls[0][1] as string[];
      const remoteCmd = args[args.length - 1];
      expect(remoteCmd).toContain('socat');
      expect(remoteCmd).toContain(defaultOpts.remoteSocketPath);
    });

    it('sends newline-terminated JSON payload', async () => {
      const transport = new SSHTransport(defaultOpts);
      const response = { jsonrpc: '2.0', id: 1, result: {} };

      mockExeca.mockResolvedValue({
        stdout: JSON.stringify(response),
        stderr: '', exitCode: 0,
      } as any);

      await transport.request({
        jsonrpc: '2.0', id: 1, method: 'test', params: { foo: 'bar' },
      });

      const opts = mockExeca.mock.calls[0][2] as any;
      expect(opts.input).toMatch(/\n$/);
      const parsed = JSON.parse(opts.input.trim());
      expect(parsed.method).toBe('test');
      expect(parsed.params).toEqual({ foo: 'bar' });
    });

    it('handles non-zero exit with stdout (parses response)', async () => {
      const transport = new SSHTransport(defaultOpts);
      const response = { jsonrpc: '2.0', id: 1, error: { code: -1, message: 'err' } };

      mockExeca.mockResolvedValue({
        stdout: JSON.stringify(response),
        stderr: 'warning',
        exitCode: 1,
      } as any);

      // Non-zero exit but has stdout → should parse the JSON
      const result = await transport.request({
        jsonrpc: '2.0', id: 1, method: 'test',
      });
      expect(result).toEqual(response);
    });

    it('rejects when execa promise rejects (catch branch)', async () => {
      const transport = new SSHTransport(defaultOpts);

      // Simulate execa returning a thenable that rejects
      const rejection = Promise.reject(new Error('connection timeout'));
      // Prevent unhandled rejection warning
      rejection.catch(() => {});
      mockExeca.mockReturnValue(rejection as any);

      await expect(
        transport.request({ jsonrpc: '2.0', id: 1, method: 'test' }),
      ).rejects.toThrow('SSH transport error');
    });

    it('uses 10s timeout for SSH requests', async () => {
      const transport = new SSHTransport(defaultOpts);
      const response = { jsonrpc: '2.0', id: 1, result: {} };

      mockExeca.mockResolvedValue({
        stdout: JSON.stringify(response),
        stderr: '', exitCode: 0,
      } as any);

      await transport.request({
        jsonrpc: '2.0', id: 1, method: 'test',
      });

      const opts = mockExeca.mock.calls[0][2] as any;
      expect(opts.timeout).toBe(10_000);
    });

    it('uses reject: false for execa call', async () => {
      const transport = new SSHTransport(defaultOpts);
      const response = { jsonrpc: '2.0', id: 1, result: {} };

      mockExeca.mockResolvedValue({
        stdout: JSON.stringify(response),
        stderr: '', exitCode: 0,
      } as any);

      await transport.request({
        jsonrpc: '2.0', id: 1, method: 'test',
      });

      const opts = mockExeca.mock.calls[0][2] as any;
      expect(opts.reject).toBe(false);
    });
  });

  describe('openStream()', () => {
    it('includes -T flag to disable pseudo-terminal', async () => {
      const transport = new SSHTransport(defaultOpts);

      // Create a mock process with stdin/stdout/stderr that behave like streams
      const mockStdin = {
        write: vi.fn((_chunk: any, cb?: any) => {
          if (typeof cb === 'function') cb();
          return true;
        }),
        end: vi.fn(),
        once: vi.fn(),
        on: vi.fn(),
      };
      const mockStdout = {
        on: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      };
      const mockProc = {
        stdin: mockStdin,
        stdout: mockStdout,
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        catch: vi.fn(),
      };
      mockExeca.mockReturnValue(mockProc as any);

      await transport.openStream({
        transport: 'ssh',
        path: '/tmp/session.sock',
        token: 'test-token',
      });

      const args = mockExeca.mock.calls[0][1] as string[];
      expect(args).toContain('-T');
    });
  });
});
