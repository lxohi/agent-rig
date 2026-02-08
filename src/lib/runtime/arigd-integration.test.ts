import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type Socket } from 'node:net';
import { LocalSocketTransport } from './transports/LocalSocketTransport.js';
import { DaemonClient, DaemonRpcError } from './daemon-client.js';
import { JSON_RPC_ERRORS } from './daemon-protocol.js';
import type { JsonRpcRequest, JsonRpcResponse } from './daemon-protocol.js';

describe('arigd integration', () => {
  let testDir: string;
  let socketPath: string;
  let server: Server;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'arigd-test-'));
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
              socket.write(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' },
              }) + '\n');
            }
          }
        });
      });
      server.listen(socketPath, () => resolve(server));
    });
  }

  describe('LocalSocketTransport + DaemonClient', () => {
    it('runtime.ping round-trip over unix socket', async () => {
      await startTestDaemon((req) => ({
        jsonrpc: '2.0',
        id: req.id,
        result: { pong: true },
      }));

      const transport = new LocalSocketTransport(socketPath);
      const client = new DaemonClient({ transport });

      const result = await client.call('runtime.ping', {});
      expect(result).toEqual({ pong: true });

      await client.close();
    });

    it('runtime.version round-trip over unix socket', async () => {
      const versionInfo = {
        version: '0.7.0',
        protocolVersion: '1',
        platform: 'linux',
      };
      await startTestDaemon((req) => ({
        jsonrpc: '2.0',
        id: req.id,
        result: versionInfo,
      }));

      const transport = new LocalSocketTransport(socketPath);
      const client = new DaemonClient({ transport });

      const result = await client.call('runtime.version', {});
      expect(result).toEqual(versionInfo);

      await client.close();
    });

    it('propagates RPC errors over socket', async () => {
      await startTestDaemon((req) => ({
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          message: 'Method not implemented: sandbox.create',
        },
      }));

      const transport = new LocalSocketTransport(socketPath);
      const client = new DaemonClient({ transport, maxRetries: 0 });

      await expect(
        client.call('sandbox.create', { sandboxName: 'test' })
      ).rejects.toThrow(DaemonRpcError);

      await client.close();
    });

    it('handles multiple sequential requests', async () => {
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

      await client.call('runtime.ping', {});
      await client.call('runtime.ping', {});
      await client.call('runtime.ping', {});

      expect(reqCount).toBe(3);
      await client.close();
    });

    it('fails when socket does not exist', async () => {
      const transport = new LocalSocketTransport(
        join(testDir, 'nonexistent.sock')
      );
      const client = new DaemonClient({
        transport,
        maxRetries: 0,
        timeoutMs: 500,
      });

      await expect(
        client.call('runtime.ping', {})
      ).rejects.toThrow();

      await client.close();
    });
  });
});
