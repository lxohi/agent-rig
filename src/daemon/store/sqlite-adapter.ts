/**
 * SQLite adapter — abstracts over bun:sqlite (production) and better-sqlite3 (tests).
 *
 * Production builds compile with Bun, so `bun:sqlite` is available natively.
 * Tests run under Node/vitest, where `better-sqlite3` is used instead.
 *
 * Both libraries share a very similar API (bun:sqlite was inspired by better-sqlite3).
 * Key differences handled here:
 *   - bun:sqlite: `new Database(path, { strict: true })` — named params without prefix
 *   - better-sqlite3: `new Database(path)` — named params without prefix by default
 *   - bun:sqlite: no `.pragma()` method — use `db.run('PRAGMA ...')`
 *   - better-sqlite3: `.pragma('key = value')` helper
 */

// ---------------------------------------------------------------------------
// Minimal interface that both drivers satisfy
// ---------------------------------------------------------------------------

export interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  getUserVersion(): number;
  setUserVersion(version: number): void;
}

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

const isBun =
  typeof globalThis !== 'undefined' &&
  'Bun' in globalThis;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function openDatabase(path: string): SqliteDatabase {
  if (isBun) {
    return openBunDatabase(path);
  }
  return openBetterSqlite3Database(path);
}

// ---------------------------------------------------------------------------
// bun:sqlite backend
// ---------------------------------------------------------------------------

function openBunDatabase(path: string): SqliteDatabase {
  // Dynamic import to avoid Node parse errors — this path only runs in Bun
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Database } = require('bun:sqlite');
  const db = new Database(path, { strict: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  return Object.assign(db, {
    getUserVersion(): number {
      const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
      return row?.user_version ?? 0;
    },
    setUserVersion(version: number): void {
      db.run(`PRAGMA user_version = ${version}`);
    },
  }) as SqliteDatabase;
}

// ---------------------------------------------------------------------------
// better-sqlite3 backend (tests under Node/vitest)
// ---------------------------------------------------------------------------

function openBetterSqlite3Database(path: string): SqliteDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return Object.assign(db, {
    getUserVersion(): number {
      return db.pragma('user_version', { simple: true }) as number;
    },
    setUserVersion(version: number): void {
      db.pragma(`user_version = ${version}`);
    },
  }) as SqliteDatabase;
}
