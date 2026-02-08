import { describe, it, expect, beforeEach } from 'vitest';
import { DaemonClient, DaemonRpcError } from './daemon-client.js';
import type {
  DaemonTransport,
  JsonRpcRequest,
  JsonRpcResponse,
  StreamEndpoint,
} from './daemon-protocol.js';
import { JSON_RPC_ERRORS, DAEMON_ERRORS } from './daemon-protocol.js';
import type { Duplex } from 'node:stream';

function createMockTransport(
  handler: (req: JsonRpcRequest) => JsonRpcResponse
): DaemonTransport {
  return {
    async request(req: JsonRpcRequest): Promise<JsonRpcResponse> {
      return handler(req);
    },
    async openStream(_endpoint: StreamEndpoint): Promise<Duplex> {
      throw new Error('not implemented in mock');
    },
    async close(): Promise<void> {},
  };
}

describe('DaemonClient', () => {
  describe('call', () => {
    it('sends runtime.ping and receives pong', async () => {
      const transport = createMockTransport((req) => ({
        jsonrpc: '2.0',
        id: req.id,
        result: { pong: true },
      }));
      const client = new DaemonClient({ transport });

      const result = await client.call('runtime.ping', {});
      expect(result).toEqual({ pong: true });
    });

    it('sends runtime.version and receives version info', async () => {
      const versionResult = {
        version: '0.7.0',
        protocolVersion: '1',
        platform: 'linux',
      };
      const transport = createMockTransport((req) => ({
        jsonrpc: '2.0',
        id: req.id,
        result: versionResult,
      }));
      const client = new DaemonClient({ transport });

      const result = await client.call('runtime.version', {});
      expect(result).toEqual(versionResult);
    });

    it('increments request ids', async () => {
      const ids: (string | number)[] = [];
      const transport = createMockTransport((req) => {
        ids.push(req.id);
        return { jsonrpc: '2.0', id: req.id, result: { pong: true } };
      });
      const client = new DaemonClient({ transport });

      await client.call('runtime.ping', {});
      await client.call('runtime.ping', {});
      await client.call('runtime.ping', {});

      expect(ids).toEqual([1, 2, 3]);
    });
  });

  describe('error handling', () => {
    it('throws DaemonRpcError on RPC error response', async () => {
      const transport = createMockTransport((req) => ({
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: DAEMON_ERRORS.SANDBOX_NOT_FOUND,
          message: 'Sandbox "foo" not found',
        },
      }));
      const client = new DaemonClient({ transport, maxRetries: 0 });

      await expect(client.call('sandbox.inspect', { sandboxName: 'foo' }))
        .rejects.toThrow(DaemonRpcError);

      try {
        await client.call('sandbox.inspect', { sandboxName: 'foo' });
      } catch (err) {
        expect(err).toBeInstanceOf(DaemonRpcError);
        expect((err as DaemonRpcError).code).toBe(DAEMON_ERRORS.SANDBOX_NOT_FOUND);
      }
    });

    it('does not retry non-retryable errors', async () => {
      let callCount = 0;
      const transport = createMockTransport((req) => {
        callCount++;
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: DAEMON_ERRORS.SANDBOX_NOT_FOUND,
            message: 'not found',
          },
        };
      });
      const client = new DaemonClient({ transport, maxRetries: 3 });

      await expect(client.call('sandbox.inspect', { sandboxName: 'x' }))
        .rejects.toThrow();
      expect(callCount).toBe(1);
    });
  });

  describe('retry logic', () => {
    it('retries on INTERNAL_ERROR and eventually succeeds', async () => {
      let callCount = 0;
      const transport = createMockTransport((req) => {
        callCount++;
        if (callCount < 3) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: JSON_RPC_ERRORS.INTERNAL_ERROR,
              message: 'transient failure',
            },
          };
        }
        return { jsonrpc: '2.0', id: req.id, result: { pong: true } };
      });
      const client = new DaemonClient({
        transport,
        maxRetries: 3,
        baseRetryDelayMs: 10,
      });

      const result = await client.call('runtime.ping', {});
      expect(result).toEqual({ pong: true });
      expect(callCount).toBe(3);
    });

    it('throws after exhausting retries', async () => {
      const transport = createMockTransport((req) => ({
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR,
          message: 'persistent failure',
        },
      }));
      const client = new DaemonClient({
        transport,
        maxRetries: 2,
        baseRetryDelayMs: 10,
      });

      await expect(client.call('runtime.ping', {})).rejects.toThrow('persistent failure');
    });
  });

  describe('timeout', () => {
    it('times out when transport hangs', async () => {
      const transport: DaemonTransport = {
        async request(): Promise<JsonRpcResponse> {
          return new Promise(() => {}); // never resolves
        },
        async openStream(): Promise<Duplex> {
          throw new Error('not implemented');
        },
        async close(): Promise<void> {},
      };
      const client = new DaemonClient({
        transport,
        timeoutMs: 50,
        maxRetries: 0,
      });

      await expect(client.call('runtime.ping', {}))
        .rejects.toThrow('timed out');
    });
  });
});
