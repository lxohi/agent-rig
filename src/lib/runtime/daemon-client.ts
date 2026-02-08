import type {
  DaemonTransport,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  MethodMap,
  DaemonMethod,
} from './daemon-protocol.js';
import { JSON_RPC_ERRORS, DAEMON_ERRORS } from './daemon-protocol.js';

export class DaemonRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(err: JsonRpcError) {
    super(err.message);
    this.name = 'DaemonRpcError';
    this.code = err.code;
    this.data = err.data;
  }
}

export interface DaemonClientOptions {
  transport: DaemonTransport;
  timeoutMs?: number;
  maxRetries?: number;
  baseRetryDelayMs?: number;
}

export class DaemonClient {
  private transport: DaemonTransport;
  private timeoutMs: number;
  private maxRetries: number;
  private baseRetryDelayMs: number;
  private nextId = 1;

  constructor(opts: DaemonClientOptions) {
    this.transport = opts.transport;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseRetryDelayMs = opts.baseRetryDelayMs ?? 200;
  }

  async call<M extends DaemonMethod>(
    method: M,
    params: MethodMap[M]['params']
  ): Promise<MethodMap[M]['result']> {
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params: params as Record<string, unknown>,
    };

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.baseRetryDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }

      try {
        const response = await withTimeout(
          this.transport.request(req),
          this.timeoutMs
        );
        return this.unwrap<M>(response);
      } catch (err) {
        lastError = err as Error;
        if (!isRetryable(err)) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error('DaemonClient: unexpected retry exhaustion');
  }

  private unwrap<M extends DaemonMethod>(
    response: JsonRpcResponse
  ): MethodMap[M]['result'] {
    if (response.error) {
      throw new DaemonRpcError(response.error);
    }
    return response.result as MethodMap[M]['result'];
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof DaemonRpcError) {
    // Don't retry application-level errors (wrong state, not found, etc.)
    // Only retry transient infrastructure errors
    return err.code === DAEMON_ERRORS.DAEMON_UNAVAILABLE
      || err.code === DAEMON_ERRORS.TIMEOUT
      || err.code === JSON_RPC_ERRORS.INTERNAL_ERROR;
  }
  // Network/socket errors are retryable
  if (err instanceof Error) {
    return err.message.includes('socket error')
      || err.message.includes('ECONNREFUSED')
      || err.message.includes('ENOENT')
      || err.message.includes('timed out');
  }
  return false;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Request timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
