import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../../lib/logging.js';
import { openDatabase, type SqliteDatabase } from './sqlite-adapter.js';

const DEFAULT_DB_PATH = join(homedir(), '.agent-rig', 'runtime', 'state.db');

// ---------------------------------------------------------------------------
// Schema version — bump when tables change
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface SandboxRow {
  name: string;
  state: string;
  pid: number | null;
  started_at: string | null;
  driver: string | null;
  sandbox_id: string | null;
  sandbox_user: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface PortBindingRow {
  id: string;
  sandbox_name: string;
  host_port: number;
  target_port: number;
  protocol: string;
  bind_address: string;
  status: string;
  created_at: string;
  last_error: string | null;
}

export interface ProxyRow {
  id: string;
  port_binding_id: string;
  pid: number | null;
  status: string;
  started_at: string | null;
  last_error: string | null;
}

export interface EventRow {
  id?: number;
  timestamp: string;
  event_type: string;
  sandbox_name: string | null;
  detail: string | null;
}

// ---------------------------------------------------------------------------
// StateDb class
// ---------------------------------------------------------------------------

export class StateDb {
  private db: SqliteDatabase;

  constructor(dbPath?: string) {
    const path = dbPath ?? DEFAULT_DB_PATH;
    this.db = openDatabase(path);
    this.migrate();
  }

  // -------------------------------------------------------------------------
  // Schema migration
  // -------------------------------------------------------------------------

  private migrate(): void {
    const currentVersion = this.db.getUserVersion();

    if (currentVersion >= SCHEMA_VERSION) return;

    this.db.transaction(() => {
      if (currentVersion < 1) this.migrateV1();
      this.db.setUserVersion(SCHEMA_VERSION);
    })();

    logger.info('state.db migrated', {
      component: 'state-db',
      event: 'migrate',
      from: currentVersion,
      to: SCHEMA_VERSION,
    });
  }

  private migrateV1(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sandboxes (
        name         TEXT PRIMARY KEY,
        state        TEXT NOT NULL DEFAULT 'unknown',
        pid          INTEGER,
        started_at   TEXT,
        driver       TEXT,
        sandbox_id   TEXT,
        sandbox_user TEXT,
        last_error   TEXT,
        updated_at   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS port_bindings (
        id            TEXT PRIMARY KEY,
        sandbox_name  TEXT NOT NULL REFERENCES sandboxes(name) ON DELETE CASCADE,
        host_port     INTEGER NOT NULL,
        target_port   INTEGER NOT NULL,
        protocol      TEXT NOT NULL DEFAULT 'tcp',
        bind_address  TEXT NOT NULL DEFAULT '127.0.0.1',
        status        TEXT NOT NULL DEFAULT 'pending',
        created_at    TEXT NOT NULL,
        last_error    TEXT
      );

      CREATE TABLE IF NOT EXISTS proxies (
        id               TEXT PRIMARY KEY,
        port_binding_id  TEXT NOT NULL REFERENCES port_bindings(id) ON DELETE CASCADE,
        pid              INTEGER,
        status           TEXT NOT NULL DEFAULT 'stopped',
        started_at       TEXT,
        last_error       TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp     TEXT NOT NULL,
        event_type    TEXT NOT NULL,
        sandbox_name  TEXT,
        detail        TEXT
      );
    `);
  }

  // -------------------------------------------------------------------------
  // Sandbox CRUD
  // -------------------------------------------------------------------------

  upsertSandbox(row: SandboxRow): void {
    this.db.prepare(`
      INSERT INTO sandboxes (name, state, pid, started_at, driver, sandbox_id, sandbox_user, last_error, updated_at)
      VALUES (@name, @state, @pid, @started_at, @driver, @sandbox_id, @sandbox_user, @last_error, @updated_at)
      ON CONFLICT(name) DO UPDATE SET
        state = excluded.state,
        pid = excluded.pid,
        started_at = excluded.started_at,
        driver = excluded.driver,
        sandbox_id = excluded.sandbox_id,
        sandbox_user = excluded.sandbox_user,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(row);
  }

  getSandbox(name: string): SandboxRow | undefined {
    return this.db.prepare(
      'SELECT * FROM sandboxes WHERE name = ?'
    ).get(name) as SandboxRow | undefined;
  }

  listSandboxes(): SandboxRow[] {
    return this.db.prepare('SELECT * FROM sandboxes').all() as SandboxRow[];
  }

  deleteSandbox(name: string): void {
    this.db.prepare('DELETE FROM sandboxes WHERE name = ?').run(name);
  }

  updateSandboxState(name: string, state: string, lastError?: string): void {
    this.db.prepare(`
      UPDATE sandboxes SET state = ?, last_error = ?, updated_at = ? WHERE name = ?
    `).run(state, lastError ?? null, new Date().toISOString(), name);
  }

  // -------------------------------------------------------------------------
  // Port binding CRUD
  // -------------------------------------------------------------------------

  upsertPortBinding(row: PortBindingRow): void {
    this.db.prepare(`
      INSERT INTO port_bindings (id, sandbox_name, host_port, target_port, protocol, bind_address, status, created_at, last_error)
      VALUES (@id, @sandbox_name, @host_port, @target_port, @protocol, @bind_address, @status, @created_at, @last_error)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        last_error = excluded.last_error
    `).run(row);
  }

  getPortBindings(sandboxName: string): PortBindingRow[] {
    return this.db.prepare(
      'SELECT * FROM port_bindings WHERE sandbox_name = ?'
    ).all(sandboxName) as PortBindingRow[];
  }

  deletePortBinding(id: string): void {
    this.db.prepare('DELETE FROM port_bindings WHERE id = ?').run(id);
  }

  updatePortBindingStatus(id: string, status: string, lastError?: string): void {
    this.db.prepare(
      'UPDATE port_bindings SET status = ?, last_error = ? WHERE id = ?'
    ).run(status, lastError ?? null, id);
  }

  // -------------------------------------------------------------------------
  // Proxy CRUD
  // -------------------------------------------------------------------------

  upsertProxy(row: ProxyRow): void {
    this.db.prepare(`
      INSERT INTO proxies (id, port_binding_id, pid, status, started_at, last_error)
      VALUES (@id, @port_binding_id, @pid, @status, @started_at, @last_error)
      ON CONFLICT(id) DO UPDATE SET
        pid = excluded.pid,
        status = excluded.status,
        started_at = excluded.started_at,
        last_error = excluded.last_error
    `).run(row);
  }

  getProxies(): ProxyRow[] {
    return this.db.prepare('SELECT * FROM proxies').all() as ProxyRow[];
  }

  deleteProxy(id: string): void {
    this.db.prepare('DELETE FROM proxies WHERE id = ?').run(id);
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  insertEvent(event: Omit<EventRow, 'id'>): void {
    this.db.prepare(`
      INSERT INTO events (timestamp, event_type, sandbox_name, detail)
      VALUES (@timestamp, @event_type, @sandbox_name, @detail)
    `).run(event);
  }

  getRecentEvents(limit = 100): EventRow[] {
    return this.db.prepare(
      'SELECT * FROM events ORDER BY id DESC LIMIT ?'
    ).all(limit) as EventRow[];
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }

  /** Run a function inside a transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

/** Create the runtime directory and return a StateDb instance. */
export async function openStateDb(dbPath?: string): Promise<StateDb> {
  const path = dbPath ?? DEFAULT_DB_PATH;
  await mkdir(dirname(path), { recursive: true });
  return new StateDb(path);
}
