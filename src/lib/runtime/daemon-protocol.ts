import type { Duplex } from 'node:stream';
import type { PortMapping } from '../types.js';
import type { SandboxState } from './types.js';

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 base types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/** Standard JSON-RPC 2.0 error codes */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** Application-specific error codes */
export const DAEMON_ERRORS = {
  SANDBOX_NOT_FOUND: 1001,
  SANDBOX_ALREADY_EXISTS: 1002,
  SANDBOX_WRONG_STATE: 1003,
  PORT_CONFLICT: 1004,
  PORT_NOT_FOUND: 1005,
  ROOT_HELPER_UNAVAILABLE: 1006,
  DAEMON_UNAVAILABLE: 1007,
  DESTROY_DEGRADED: 1008,
  SESSION_NOT_FOUND: 1009,
  TIMEOUT: 1010,
  RECONCILE_IN_PROGRESS: 1011,
} as const;

// ---------------------------------------------------------------------------
// Stream endpoint (for exec/attach PTY sessions)
// ---------------------------------------------------------------------------

export interface StreamEndpoint {
  transport: 'unix-socket' | 'ssh';
  path: string;
  token: string;
}

// ---------------------------------------------------------------------------
// Method names
// ---------------------------------------------------------------------------

export type DaemonMethod =
  | 'runtime.ping'
  | 'runtime.version'
  | 'runtime.gc'
  | 'sandbox.create'
  | 'sandbox.start'
  | 'sandbox.stop'
  | 'sandbox.destroy'
  | 'sandbox.inspect'
  | 'sandbox.exec.run'
  | 'sandbox.exec.startSession'
  | 'sandbox.attach.startSession'
  | 'port.add'
  | 'port.remove'
  | 'port.list';

// ---------------------------------------------------------------------------
// Per-method params & result types — runtime.*
// ---------------------------------------------------------------------------

export interface RuntimePingParams {}
export interface RuntimePingResult {
  pong: true;
}

export interface RuntimeVersionParams {}
export interface RuntimeVersionResult {
  version: string;
  protocolVersion: string;
  platform: string;
}

export interface RuntimeGcParams {
  dryRun?: boolean;
}
export interface RuntimeGcResult {
  cleaned: string[];
}

// ---------------------------------------------------------------------------
// Per-method params & result types — sandbox.*
// ---------------------------------------------------------------------------

export interface SandboxCreateParams {
  sandboxName: string;
  config?: Record<string, unknown>;
  idempotencyKey?: string;
}
export interface SandboxCreateResult {
  sandboxId: string;
}

export interface SandboxStartParams {
  sandboxName: string;
  idempotencyKey?: string;
}
export interface SandboxStartResult {}

export interface SandboxStopParams {
  sandboxName: string;
  idempotencyKey?: string;
}
export interface SandboxStopResult {}

export interface SandboxDestroyParams {
  sandboxName: string;
  idempotencyKey?: string;
}
export interface SandboxDestroyResult {}

export interface SandboxInspectParams {
  sandboxName: string;
}
export interface SandboxInspectResult {
  state: SandboxState;
  pid?: number;
  ports?: PortMapping[];
  startedAt?: string;
}

// ---------------------------------------------------------------------------
// Per-method params & result types — sandbox.exec / sandbox.attach
// ---------------------------------------------------------------------------

export interface ExecRunParams {
  sandboxName: string;
  command: string[];
  timeout?: number;
  env?: Record<string, string>;
}
export interface ExecRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecStartSessionParams {
  sandboxName: string;
  command: string[];
  env?: Record<string, string>;
  term?: string;
}
export interface ExecStartSessionResult {
  sessionId: string;
  streamEndpoint: StreamEndpoint;
}

export interface AttachStartSessionParams {
  sandboxName: string;
}
export interface AttachStartSessionResult {
  sessionId: string;
  streamEndpoint: StreamEndpoint;
}

// ---------------------------------------------------------------------------
// Per-method params & result types — port.*
// ---------------------------------------------------------------------------

export interface PortAddParams {
  sandboxName: string;
  hostPort: number;
  targetPort: number;
  protocol?: 'tcp' | 'udp';
  bindAddress?: string;
  idempotencyKey?: string;
}
export interface PortAddResult {
  id: string;
  status: 'active' | 'pending';
}

export interface PortRemoveParams {
  sandboxName: string;
  portId: string;
  idempotencyKey?: string;
}
export interface PortRemoveResult {}

export interface PortListParams {
  sandboxName: string;
}
export interface PortListResult {
  ports: PortMapping[];
}

// ---------------------------------------------------------------------------
// Type-safe method map
// ---------------------------------------------------------------------------

export interface MethodMap {
  'runtime.ping': { params: RuntimePingParams; result: RuntimePingResult };
  'runtime.version': { params: RuntimeVersionParams; result: RuntimeVersionResult };
  'runtime.gc': { params: RuntimeGcParams; result: RuntimeGcResult };
  'sandbox.create': { params: SandboxCreateParams; result: SandboxCreateResult };
  'sandbox.start': { params: SandboxStartParams; result: SandboxStartResult };
  'sandbox.stop': { params: SandboxStopParams; result: SandboxStopResult };
  'sandbox.destroy': { params: SandboxDestroyParams; result: SandboxDestroyResult };
  'sandbox.inspect': { params: SandboxInspectParams; result: SandboxInspectResult };
  'sandbox.exec.run': { params: ExecRunParams; result: ExecRunResult };
  'sandbox.exec.startSession': { params: ExecStartSessionParams; result: ExecStartSessionResult };
  'sandbox.attach.startSession': { params: AttachStartSessionParams; result: AttachStartSessionResult };
  'port.add': { params: PortAddParams; result: PortAddResult };
  'port.remove': { params: PortRemoveParams; result: PortRemoveResult };
  'port.list': { params: PortListParams; result: PortListResult };
}

// ---------------------------------------------------------------------------
// DaemonTransport interface
// ---------------------------------------------------------------------------

export interface DaemonTransport {
  request(req: JsonRpcRequest): Promise<JsonRpcResponse>;
  openStream(endpoint: StreamEndpoint): Promise<Duplex>;
  close(): Promise<void>;
}
