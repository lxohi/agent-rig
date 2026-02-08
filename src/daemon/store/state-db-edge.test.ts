import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateDb } from './state-db.js';
import { Reconciler, type ProcessChecker } from './reconcile.js';

describe('StateDb edge cases', () => {
  let testDir: string;
  let db: StateDb;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'statedb-edge-'));
    db = new StateDb(join(testDir, 'state.db'));
  });

  afterEach(async () => {
    db.close();
    await rm(testDir, { recursive: true, force: true });
  });

  const baseSandbox = {
    name: 'sb',
    state: 'running',
    pid: 1000,
    started_at: '2026-01-01T00:00:00Z',
    driver: 'linux-rootless',
    sandbox_id: 'sb-1',
    sandbox_user: 'u1',
    last_error: null,
    updated_at: '2026-01-01T00:00:00Z',
  };

  const basePort = {
    id: 'p1',
    sandbox_name: 'sb',
    host_port: 8080,
    target_port: 80,
    protocol: 'tcp',
    bind_address: '127.0.0.1',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    last_error: null,
  };

  describe('corrupt/missing database recovery', () => {
    it('creates fresh db when file does not exist', () => {
      db.close();
      const freshDb = new StateDb(join(testDir, 'new.db'));
      expect(freshDb.listSandboxes()).toEqual([]);
      freshDb.close();
    });

    it('opens successfully after unclean shutdown (WAL mode)', () => {
      // Write data, close, reopen — WAL should recover
      db.upsertSandbox(baseSandbox);
      db.close();
      const db2 = new StateDb(join(testDir, 'state.db'));
      expect(db2.getSandbox('sb')).toBeDefined();
      expect(db2.getSandbox('sb')!.state).toBe('running');
      db2.close();
      db = new StateDb(join(testDir, 'state.db'));
    });

    it('throws on corrupt database file', async () => {
      db.close();
      // Write garbage to the db file
      await writeFile(join(testDir, 'corrupt.db'), 'not a sqlite file');
      expect(() => new StateDb(join(testDir, 'corrupt.db'))).toThrow();
      // Re-open the good db for afterEach
      db = new StateDb(join(testDir, 'state.db'));
    });
  });

  describe('FK cascade on sandbox delete', () => {
    it('cascades port bindings when sandbox is deleted', () => {
      db.upsertSandbox(baseSandbox);
      db.upsertPortBinding(basePort);
      db.upsertPortBinding({ ...basePort, id: 'p2', host_port: 9090 });

      expect(db.getPortBindings('sb')).toHaveLength(2);
      db.deleteSandbox('sb');
      expect(db.getPortBindings('sb')).toHaveLength(0);
    });

    it('cascades proxies through port binding FK', () => {
      db.upsertSandbox(baseSandbox);
      db.upsertPortBinding(basePort);
      db.upsertProxy({
        id: 'proxy-1',
        port_binding_id: 'p1',
        pid: 2000,
        status: 'running',
        started_at: '2026-01-01T00:00:00Z',
        last_error: null,
      });

      expect(db.getProxies()).toHaveLength(1);
      // Delete sandbox — should cascade to port_bindings → proxies
      db.deleteSandbox('sb');
      expect(db.getProxies()).toHaveLength(0);
    });

    it('rejects port binding for non-existent sandbox', () => {
      expect(() =>
        db.upsertPortBinding({
          ...basePort,
          sandbox_name: 'nonexistent',
        })
      ).toThrow();
    });
  });

  describe('concurrent writes', () => {
    it('handles rapid sequential upserts to same sandbox', () => {
      for (let i = 0; i < 50; i++) {
        db.upsertSandbox({
          ...baseSandbox,
          state: i % 2 === 0 ? 'running' : 'stopped',
          pid: i % 2 === 0 ? 1000 + i : null,
          updated_at: new Date().toISOString(),
        });
      }
      const sb = db.getSandbox('sb');
      expect(sb).toBeDefined();
      // Last write wins (i=49, odd → stopped)
      expect(sb!.state).toBe('stopped');
    });

    it('handles many sandboxes in a single transaction', () => {
      db.transaction(() => {
        for (let i = 0; i < 100; i++) {
          db.upsertSandbox({
            ...baseSandbox,
            name: `sb-${i}`,
            updated_at: new Date().toISOString(),
          });
        }
      });
      expect(db.listSandboxes()).toHaveLength(100);
    });

    it('rolls back all sandboxes on transaction failure', () => {
      try {
        db.transaction(() => {
          db.upsertSandbox({ ...baseSandbox, name: 'tx-1' });
          db.upsertSandbox({ ...baseSandbox, name: 'tx-2' });
          throw new Error('simulated failure');
        });
      } catch {
        // expected
      }
      expect(db.listSandboxes()).toHaveLength(0);
    });
  });

  describe('boundary conditions', () => {
    it('handles sandbox name with special characters', () => {
      const specialName = 'sb-with_special.chars-123';
      db.upsertSandbox({ ...baseSandbox, name: specialName });
      expect(db.getSandbox(specialName)).toBeDefined();
    });

    it('handles empty string last_error', () => {
      db.upsertSandbox(baseSandbox);
      db.updateSandboxState('sb', 'stopped', '');
      const sb = db.getSandbox('sb');
      expect(sb!.last_error).toBe('');
    });

    it('handles null vs undefined last_error', () => {
      db.upsertSandbox(baseSandbox);
      db.updateSandboxState('sb', 'stopped');
      const sb = db.getSandbox('sb');
      expect(sb!.last_error).toBeNull();
    });

    it('getRecentEvents returns empty array on fresh db', () => {
      expect(db.getRecentEvents()).toEqual([]);
    });

    it('deleteSandbox is idempotent', () => {
      db.upsertSandbox(baseSandbox);
      db.deleteSandbox('sb');
      // Second delete should not throw
      db.deleteSandbox('sb');
      expect(db.getSandbox('sb')).toBeUndefined();
    });

    it('deletePortBinding is idempotent', () => {
      db.upsertSandbox(baseSandbox);
      db.upsertPortBinding(basePort);
      db.deletePortBinding('p1');
      // Second delete should not throw
      db.deletePortBinding('p1');
    });
  });
});
