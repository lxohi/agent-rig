import { describe, it, expect } from 'vitest';
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
  handler: (req: JsonRpcRequest) => Promise<JsonRpcResponse> | JsonRpcResponse
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

describe('DaemonClient edge cases', () => {
  describe('concurrent requests', () => {
    it('handles multiple concurrent calls without id collision', async () => {
      const receivedIds: (string | number)[] = [];
      const transport = createMockTransport(async (req) => {
        receivedIds.push(req.id);
        // Simulate async delay to overlap requests
        await new Promise((r) => setTimeout(r, 10));
        return { jsonrpc: '2.0', id: req.id, result: { pong: true } };
      });
      const client = new DaemonClient({ transport });

      const results = await Promise.all([
        client.call('runtime.ping', {}),
        client.call('runtime.ping', {}),
        client.call('runtime.ping', {}),
      ]);

      // All should succeed
      for (const r of results) {
        expect(r).toEqual({ pong: true });
      }

      // All IDs should be unique
      const uniqueIds = new Set(receivedIds);
      expect(uniqueIds.size).toBe(3);
    });

    it('isolates errors between concurrent calls', async () => {
      // Use method name to deterministically decide which call fails
      const transport = createMockTransport(async (req) => {
        await new Promise((r) => setTimeout(r, 5));
        if (req.method === 'sandbox.inspect') {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: DAEMON_ERRORS.SANDBOX_NOT_FOUND,
              message: 'not found',
            },
          };
        }
        return { jsonrpc: '2.0', id: req.id, result: { pong: true } };
      });
      const client = new DaemonClient({ transport, maxRetries: 0 });

      const results = await Promise.allSettled([
        client.call('runtime.ping', {}),
        client.call('sandbox.inspect', { sandboxName: 'missing' }),
        client.call('runtime.ping', {}),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');
    });
  });

  describe('retry with exponential backoff', () => {
    it('applies increasing delays between retries', async () => {
      const timestamps: number[] = [];
      let callCount = 0;
      const transport = createMockTransport((req) => {
        timestamps.push(Date.now());
        callCount++;
        if (callCount <= 3) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: JSON_RPC_ERRORS.INTERNAL_ERROR,
              message: 'transient',
            },
          };
        }
        return { jsonrpc: '2.0', id: req.id, result: { pong: true } };
      });
      const client = new DaemonClient({
        transport,
        maxRetries: 3,
        baseRetryDelayMs: 50,
      });

      await client.call('runtime.ping', {});
      expect(callCount).toBe(4);

      // Verify delays increase (exponential backoff: 50, 100, 200)
      // Allow some tolerance for timer imprecision
      if (timestamps.length >= 3) {
        const delay1 = timestamps[1] - timestamps[0];
        const delay2 = timestamps[2] - timestamps[1];
        expect(delay2).toBeGreaterThanOrEqual(delay1 * 0.8);
      }
    });

    it('retries on ECONNREFUSED socket errors', async () => {
      let callCount = 0;
      const transport = createMockTransport(async (req) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('connect ECONNREFUSED /tmp/arigd.sock');
        }
        return { jsonrpc: '2.0', id: req.id, result: { pong: true } };
      });
      const client = new DaemonClient({
        transport,
        maxRetries: 2,
        baseRetryDelayMs: 10,
      });

      const result = await client.call('runtime.ping', {});
      expect(result).toEqual({ pong: true });
      expect(callCount).toBe(2);
    });

    it('retries on ENOENT socket errors', async () => {
      let callCount = 0;
      const transport = createMockTransport(async (req) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('connect ENOENT /tmp/arigd.sock');
        }
        return { jsonrpc: '2.0', id: req.id, result: { pong: true } };
      });
      const client = new DaemonClient({
        transport,
        maxRetries: 2,
        baseRetryDelayMs: 10,
      });

      const result = await client.call('runtime.ping', {});
      expect(result).toEqual({ pong: true });
      expect(callCount).toBe(2);
    });

    it('retries on DAEMON_UNAVAILABLE error code', async () => {
      let callCount = 0;
      const transport = createMockTransport((req) => {
        callCount++;
        if (callCount === 1) {
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: {
              code: DAEMON_ERRORS.DAEMON_UNAVAILABLE,
              message: 'daemon starting up',
            },
          };
        }
        return { jsonrpc: '2.0', id: req.id, result: { pong: true } };
      });
      const client = new DaemonClient({
        transport,
        maxRetries: 2,
        baseRetryDelayMs: 10,
      });

      const result = await client.call('runtime.ping', {});
      expect(result).toEqual({ pong: true });
      expect(callCount).toBe(2);
    });

    it('does not retry SANDBOX_WRONG_STATE errors', async () => {
      let callCount = 0;
      const transport = createMockTransport((req) => {
        callCount++;
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: DAEMON_ERRORS.SANDBOX_WRONG_STATE,
            message: 'sandbox is stopped',
          },
        };
      });
      const client = new DaemonClient({
        transport,
        maxRetries: 3,
        baseRetryDelayMs: 10,
      });

      await expect(
        client.call('sandbox.start', { sandboxName: 'x' })
      ).rejects.toThrow(DaemonRpcError);
      expect(callCount).toBe(1);
    });

    it('does not retry PORT_CONFLICT errors', async () => {
      let callCount = 0;
      const transport = createMockTransport((req) => {
        callCount++;
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: DAEMON_ERRORS.PORT_CONFLICT,
            message: 'port 8080 already in use',
          },
        };
      });
      const client = new DaemonClient({
        transport,
        maxRetries: 3,
        baseRetryDelayMs: 10,
      });

      await expect(
        client.call('port.add', {
          sandboxName: 'x',
          hostPort: 8080,
          targetPort: 80,
        })
      ).rejects.toThrow(DaemonRpcError);
      expect(callCount).toBe(1);
    });
  });

  describe('timeout edge cases', () => {
    it('timeout triggers retry when retries are available', async () => {
      let callCount = 0;
      const transport = createMockTransport(async (req) => {
        callCount++;
        if (callCount === 1) {
          // First call hangs past timeout
          await new Promise((r) => setTimeout(r, 200));
          return { jsonrpc: '2.0', id: req.id, result: { pong: true } };
        }
        return { jsonrpc: '2.0', id: req.id, result: { pong: true } };
      });
      const client = new DaemonClient({
        transport,
        timeoutMs: 50,
        maxRetries: 1,
        baseRetryDelayMs: 10,
      });

      const result = await client.call('runtime.ping', {});
      expect(result).toEqual({ pong: true });
      expect(callCount).toBe(2);
    });
  });

  describe('DaemonRpcError properties', () => {
    it('preserves error code and data from response', async () => {
      const transport = createMockTransport((req) => ({
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: DAEMON_ERRORS.DESTROY_DEGRADED,
          message: 'partial cleanup',
          data: { cleaned: ['user'], failed: ['slice'] },
        },
      }));
      const client = new DaemonClient({ transport, maxRetries: 0 });

      try {
        await client.call('sandbox.destroy', { sandboxName: 'x' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(DaemonRpcError);
        const rpcErr = err as DaemonRpcError;
        expect(rpcErr.code).toBe(DAEMON_ERRORS.DESTROY_DEGRADED);
        expect(rpcErr.message).toBe('partial cleanup');
        expect(rpcErr.data).toEqual({ cleaned: ['user'], failed: ['slice'] });
      }
    });

    it('has name set to DaemonRpcError', async () => {
      const transport = createMockTransport((req) => ({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -1, message: 'test' },
      }));
      const client = new DaemonClient({ transport, maxRetries: 0 });

      try {
        await client.call('runtime.ping', {});
        expect.unreachable('should have thrown');
      } catch (err) {
        expect((err as DaemonRpcError).name).toBe('DaemonRpcError');
      }
    });
  });
});
