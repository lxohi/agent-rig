import { createServer, type Server, type Socket } from 'node:net';
import { mkdir, rm, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  DaemonMethod,
} from '../lib/runtime/daemon-protocol.js';
import { JSON_RPC_ERRORS, DAEMON_ERRORS } from '../lib/runtime/daemon-protocol.js';
import type {
  ExecRunParams,
  ExecStartSessionParams,
  AttachStartSessionParams,
} from '../lib/runtime/daemon-protocol.js';
import { VERSION } from '../version.js';
import { sandboxUsername } from '../lib/runtime/linux/user.js';
import { SessionManager } from './session/session-manager.js';
import { execRun } from './session/exec-run.js';

const PROTOCOL_VERSION = '1';
const SOCKET_DIR = join(homedir(), '.agent-rig', 'run');
const SOCKET_PATH = join(SOCKET_DIR, 'arigd.sock');

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

const sessionManager = new SessionManager();

const handlers: Record<string, Handler> = {
  'runtime.ping': async () => ({ pong: true }),

  'runtime.version': async () => ({
    version: VERSION,
    protocolVersion: PROTOCOL_VERSION,
    platform: platform(),
  }),

  'sandbox.exec.run': async (params) => {
    const p = params as unknown as ExecRunParams;
    if (!p.sandboxName || !p.command?.length) {
      throw Object.assign(new Error('Missing sandboxName or command'), {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
      });
    }
    const sandboxUser = sandboxUsername(p.sandboxName);
    return execRun({
      sandboxUser,
      command: p.command,
      timeout: p.timeout,
      env: p.env,
    });
  },

  'sandbox.exec.startSession': async (params) => {
    const p = params as unknown as ExecStartSessionParams;
    if (!p.sandboxName || !p.command?.length) {
      throw Object.assign(new Error('Missing sandboxName or command'), {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
      });
    }
    const sandboxUser = sandboxUsername(p.sandboxName);
    const info = await sessionManager.createSession({
      sandboxName: p.sandboxName,
      sandboxUser,
      command: p.command,
      env: p.env,
    });
    return {
      sessionId: info.sessionId,
      streamEndpoint: info.streamEndpoint,
    };
  },

  'sandbox.attach.startSession': async (params) => {
    const p = params as unknown as AttachStartSessionParams;
    if (!p.sandboxName) {
      throw Object.assign(new Error('Missing sandboxName'), {
        code: JSON_RPC_ERRORS.INVALID_PARAMS,
      });
    }
    const sandboxUser = sandboxUsername(p.sandboxName);
    const info = await sessionManager.createSession({
      sandboxName: p.sandboxName,
      sandboxUser,
      command: ['bash', '-l'],
      env: {},
    });
    return {
      sessionId: info.sessionId,
      streamEndpoint: info.streamEndpoint,
    };
  },
};

const IMPLEMENTED_METHODS = new Set(Object.keys(handlers));

const ALL_METHODS: DaemonMethod[] = [
  'runtime.ping',
  'runtime.version',
  'runtime.gc',
  'sandbox.create',
  'sandbox.start',
  'sandbox.stop',
  'sandbox.destroy',
  'sandbox.inspect',
  'sandbox.exec.run',
  'sandbox.exec.startSession',
  'sandbox.attach.startSession',
  'port.add',
  'port.remove',
  'port.list',
];

// ---------------------------------------------------------------------------
// Request dispatch
// ---------------------------------------------------------------------------

async function dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const method = req.method;

  if (!ALL_METHODS.includes(method as DaemonMethod)) {
    return errorResponse(req.id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }

  if (!IMPLEMENTED_METHODS.has(method)) {
    return errorResponse(req.id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not implemented: ${method}`);
  }

  const handler = handlers[method]!;
  try {
    const result = await handler(req.params ?? {});
    return { jsonrpc: '2.0', id: req.id, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(req.id, JSON_RPC_ERRORS.INTERNAL_ERROR, message);
  }
}

function errorResponse(
  id: string | number,
  code: number,
  message: string
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Connection handling (newline-delimited JSON-RPC)
// ---------------------------------------------------------------------------

function handleConnection(socket: Socket): void {
  let buffer = '';

  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (!line) continue;

      processLine(line, socket);
    }
  });

  socket.on('error', () => {
    // Client disconnected — nothing to do
  });
}

async function processLine(line: string, socket: Socket): Promise<void> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(line);
  } catch {
    const resp: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: null,
      error: { code: JSON_RPC_ERRORS.PARSE_ERROR, message: 'Invalid JSON' },
    };
    socket.write(JSON.stringify(resp) + '\n');
    return;
  }

  if (!req.jsonrpc || req.jsonrpc !== '2.0' || req.id == null || !req.method) {
    const resp: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: req.id ?? null,
      error: { code: JSON_RPC_ERRORS.INVALID_REQUEST, message: 'Invalid JSON-RPC request' },
    };
    socket.write(JSON.stringify(resp) + '\n');
    return;
  }

  const response = await dispatch(req);
  socket.write(JSON.stringify(response) + '\n');
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

async function cleanStaleSocket(): Promise<void> {
  try {
    await access(SOCKET_PATH);
    await rm(SOCKET_PATH);
  } catch {
    // Socket doesn't exist — nothing to clean
  }
}

export async function startDaemon(): Promise<Server> {
  await mkdir(SOCKET_DIR, { recursive: true });
  await cleanStaleSocket();

  const server = createServer(handleConnection);

  return new Promise<Server>((resolve, reject) => {
    server.on('error', reject);

    server.listen(SOCKET_PATH, () => {
      const addr = server.address();
      const display = typeof addr === 'string' ? addr : SOCKET_PATH;
      console.log(`arigd listening on ${display}`);
      console.log(`protocol=${PROTOCOL_VERSION} version=${VERSION}`);
      resolve(server);
    });
  });
}

export function getSocketPath(): string {
  return SOCKET_PATH;
}

export function getSessionManager(): SessionManager {
  return sessionManager;
}

// ---------------------------------------------------------------------------
// Direct entry point: `arig daemon serve`
// ---------------------------------------------------------------------------

const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/arigd.ts') || process.argv[1].endsWith('/arigd.js'));

if (isDirectRun) {
  const server = await startDaemon();

  const shutdown = () => {
    console.log('arigd shutting down');
    sessionManager.destroyAll().catch(() => {}).finally(() => {
      server.close(() => {
        rm(SOCKET_PATH).catch(() => {}).finally(() => process.exit(0));
      });
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
