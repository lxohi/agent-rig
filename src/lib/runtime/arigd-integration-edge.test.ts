import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type Socket } from 'node:net';
import { LocalSocketTransport } from './transports/LocalSocketTransport.js';
import { DaemonClient, DaemonRpcError } from './daemon-client.js';
import { JSON_RPC_ERRORS } from './daemon-protocol.js';
import type { JsonRpcRequest, JsonRpcResponse } from './daemon-protocol.js';

describe('arigd integration edge cases', () => {
  let testDir: string;
  let socketPath: string;
  let server: Server;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arigd-edge-'));
    socketPath = join(testDir, 'arigd.sock');
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await rm(testDir, { recursive: true, force: true });
  });

  function startTestDaemon(
    handler: (req: JsonRpcRequest) => JsonRpcResponse
  ): Promise<Server> {
    return new Promise((resolve) => {
      server = createServer((socket: Socket) => {
        let buffer = '';
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          let idx: number;
          while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
              const req = JSON.parse(line) as JsonRpcRequest;
              const resp = handler(req);
              socket.write(JSON.stringify(resp) + '\n');
            } catch {
              socket.write(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: null,
                  error: { code: -32700, message: 'Parse error' },
                }) + '\n'
              );
            }
          }
        });
      });
      server.listen(socketPath, () => resolve(server));
    });
  }

  describe('malformed responses', () => {
    it('handles daemon returning invalid JSON', async () => {
      server = createServer((socket: Socket) => {
        socket.on('data', () => {
          socket.write('this is not json\n');
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(socketPath, () => resolve())
      );

      const transport = new LocalSocketTransport(socketPath);
      const client = new DaemonClient({
        transport,
        maxRetries: 0,
        timeoutMs: 1000,
      });

      await expect(client.call('runtime.ping', {})).rejects.toThrow();
      await client.close();
    });

    it('handles daemon returning empty response', async () => {
      server = createServer((socket: Socket) => {
        socket.on('data', () => {
          socket.write('\n');
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(socketPath, () => resolve())
      );

      const transport = new LocalSocketTransport(socketPath);
      const client = new DaemonClient({
        transport,
        maxRetries: 0,
        timeoutMs: 1000,
      });

      await expect(client.call('runtime.ping', {})).rejects.toThrow();
      await client.close();
    });

    it('handles daemon closing connection immediately', async () => {
      server = createServer((socket: Socket) => {
        socket.destroy();
      });
      await new Promise<void>((resolve) =>
        server.listen(socketPath, () => resolve())
      );

      const transport = new LocalSocketTransport(socketPath);
      const client = new DaemonClient({
        transport,
        maxRetries: 0,
        timeoutMs: 1000,
      });

      await expect(client.call('runtime.ping', {})).rejects.toThrow();
      await client.close();
    });
  });

  describe('connection failure', () => {
    it('gives clear error when socket path does not exist', async () => {
      const transport = new LocalSocketTransport(
        join(testDir, 'does-not-exist.sock')
      );
      const client = new DaemonClient({
        transport,
        maxRetries: 0,
        timeoutMs: 500,
      });

      await expect(client.call('runtime.ping', {})).rejects.toThrow(
        /socket error|ENOENT|ECONNREFUSED/
      );
      await client.close();
    });

    it('gives clear error when socket directory does not exist', async () => {
      const transport = new LocalSocketTransport(
        '/tmp/nonexistent-dir-12345/arigd.sock'
      );
      const client = new DaemonClient({
        transport,
        maxRetries: 0,
        timeoutMs: 500,
      });

      await expect(client.call('runtime.ping', {})).rejects.toThrow();
      await client.close();
    });
  });

  describe('concurrent requests over socket', () => {
    it('handles rapid sequential requests on same transport', async () => {
      let reqCount = 0;
      await startTestDaemon((req) => {
        reqCount++;
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: { pong: true },
        };
      });

      const transport = new LocalSocketTransport(socketPath);
      const client = new DaemonClient({ transport });

      // Fire 5 rapid sequential requests
      for (let i = 0; i < 5; i++) {
        const result = await client.call('runtime.ping', {});
        expect(result).toEqual({ pong: true });
      }

      expect(reqCount).toBe(5);
      await client.close();
    });
  });

  describe('protocol validation', () => {
    it('daemon returns METHOD_NOT_FOUND for unknown methods', async () => {
      await startTestDaemon((req) => ({
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          message: `Unknown method: ${req.method}`,
        },
      }));

      const transport = new LocalSocketTransport(socketPath);
      const client = new DaemonClient({ transport, maxRetries: 0 });

      await expect(
        client.call('runtime.ping', {})
      ).rejects.toThrow(DaemonRpcError);

      try {
        await client.call('runtime.ping', {});
      } catch (err) {
        expect((err as DaemonRpcError).code).toBe(
          JSON_RPC_ERRORS.METHOD_NOT_FOUND
        );
      }

      await client.close();
    });
  });
});
