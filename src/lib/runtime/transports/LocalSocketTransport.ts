import { connect, type Socket } from 'node:net';
import { Duplex } from 'node:stream';
import type {
  DaemonTransport,
  StreamEndpoint,
  JsonRpcRequest,
  JsonRpcResponse,
} from './DaemonTransport.js';

export class LocalSocketTransport implements DaemonTransport {
  private socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async request(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const payload = JSON.stringify(req) + '\n';

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      let socket: Socket;
      try {
        socket = connect(this.socketPath);
      } catch (err) {
        reject(new Error(`Failed to connect to daemon socket: ${this.socketPath}`));
        return;
      }

      let buffer = '';
      let settled = false;

      socket.on('connect', () => {
        socket.write(payload);
      });

      socket.on('data', (chunk: Buffer) => {
        if (settled) return;
        buffer += chunk.toString();
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx);
          settled = true;
          socket.destroy();
          try {
            resolve(JSON.parse(line) as JsonRpcResponse);
          } catch {
            reject(new Error('Invalid JSON response from daemon'));
          }
        }
      });

      socket.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        reject(new Error(`Daemon socket error: ${err.message}`));
      });

      socket.on('close', () => {
        if (settled) return;
        settled = true;
        if (buffer) {
          try {
            resolve(JSON.parse(buffer) as JsonRpcResponse);
          } catch {
            reject(new Error('Incomplete response from daemon'));
          }
        } else {
          reject(new Error('Connection closed without response'));
        }
      });
    });
  }

  async openStream(endpoint: StreamEndpoint): Promise<Duplex> {
    if (endpoint.transport !== 'unix-socket') {
      throw new Error(`LocalSocketTransport cannot handle transport: ${endpoint.transport}`);
    }

    return new Promise<Duplex>((resolve, reject) => {
      const socket = connect(endpoint.path);

      socket.on('connect', () => {
        // Send the session token as the first line for auth
        socket.write(endpoint.token + '\n');
        resolve(socket);
      });

      socket.on('error', (err: Error) => {
        reject(new Error(`Stream connection error: ${err.message}`));
      });
    });
  }

  async close(): Promise<void> {
    // LocalSocketTransport is stateless per-request; nothing to close.
  }
}
