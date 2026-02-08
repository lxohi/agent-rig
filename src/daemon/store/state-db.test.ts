import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateDb } from './state-db.js';

describe('StateDb', () => {
  let testDir: string;
  let db: StateDb;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'statedb-test-'));
    db = new StateDb(join(testDir, 'state.db'));
  });

  afterEach(async () => {
    db.close();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('schema', () => {
    it('creates tables on first open', () => {
      const sandboxes = db.listSandboxes();
      expect(sandboxes).toEqual([]);
    });

    it('is idempotent on re-open', () => {
      db.close();
      const db2 = new StateDb(join(testDir, 'state.db'));
      expect(db2.listSandboxes()).toEqual([]);
      db2.close();
      // re-assign so afterEach close doesn't fail
      db = new StateDb(join(testDir, 'state.db'));
    });
  });

  describe('sandbox CRUD', () => {
    const row = {
      name: 'test-sb',
      state: 'running',
      pid: 1234,
      started_at: '2026-01-01T00:00:00Z',
      driver: 'linux-rootless',
      sandbox_id: 'sb-abc',
      sandbox_user: 'sandbox_1001',
      last_error: null,
      updated_at: '2026-01-01T00:00:00Z',
    };

    it('upserts and retrieves a sandbox', () => {
      db.upsertSandbox(row);
      const result = db.getSandbox('test-sb');
      expect(result).toEqual(row);
    });

    it('updates on conflict', () => {
      db.upsertSandbox(row);
      db.upsertSandbox({ ...row, state: 'stopped', pid: null });
      const result = db.getSandbox('test-sb');
      expect(result!.state).toBe('stopped');
      expect(result!.pid).toBeNull();
    });

    it('lists all sandboxes', () => {
      db.upsertSandbox(row);
      db.upsertSandbox({ ...row, name: 'other-sb' });
      const list = db.listSandboxes();
      expect(list).toHaveLength(2);
    });

    it('deletes a sandbox', () => {
      db.upsertSandbox(row);
      db.deleteSandbox('test-sb');
      expect(db.getSandbox('test-sb')).toBeUndefined();
    });

    it('updates sandbox state', () => {
      db.upsertSandbox(row);
      db.updateSandboxState('test-sb', 'stopped', 'crashed');
      const result = db.getSandbox('test-sb');
      expect(result!.state).toBe('stopped');
      expect(result!.last_error).toBe('crashed');
    });

    it('returns undefined for non-existent sandbox', () => {
      expect(db.getSandbox('nope')).toBeUndefined();
    });
  });

  describe('port binding CRUD', () => {
    const sbRow = {
      name: 'sb-ports',
      state: 'running',
      pid: 100,
      started_at: '2026-01-01T00:00:00Z',
      driver: 'linux-rootless',
      sandbox_id: 'sb-1',
      sandbox_user: 'u1',
      last_error: null,
      updated_at: '2026-01-01T00:00:00Z',
    };

    const portRow = {
      id: 'port-1',
      sandbox_name: 'sb-ports',
      host_port: 8080,
      target_port: 80,
      protocol: 'tcp',
      bind_address: '127.0.0.1',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      last_error: null,
    };

    beforeEach(() => {
      db.upsertSandbox(sbRow);
    });

    it('upserts and retrieves port bindings', () => {
      db.upsertPortBinding(portRow);
      const ports = db.getPortBindings('sb-ports');
      expect(ports).toHaveLength(1);
      expect(ports[0]).toEqual(portRow);
    });

    it('updates status on conflict', () => {
      db.upsertPortBinding(portRow);
      db.updatePortBindingStatus('port-1', 'error', 'EADDRINUSE');
      const ports = db.getPortBindings('sb-ports');
      expect(ports[0].status).toBe('error');
      expect(ports[0].last_error).toBe('EADDRINUSE');
    });

    it('deletes a port binding', () => {
      db.upsertPortBinding(portRow);
      db.deletePortBinding('port-1');
      expect(db.getPortBindings('sb-ports')).toHaveLength(0);
    });

    it('cascades delete when sandbox is removed', () => {
      db.upsertPortBinding(portRow);
      db.deleteSandbox('sb-ports');
      // Port bindings should be gone due to FK cascade
      expect(db.getPortBindings('sb-ports')).toHaveLength(0);
    });
  });

  describe('events', () => {
    it('inserts and retrieves events', () => {
      db.insertEvent({
        timestamp: '2026-01-01T00:00:00Z',
        event_type: 'sandbox.create',
        sandbox_name: 'test',
        detail: 'created',
      });
      const events = db.getRecentEvents(10);
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('sandbox.create');
    });

    it('returns events in reverse chronological order', () => {
      db.insertEvent({
        timestamp: '2026-01-01T00:00:00Z',
        event_type: 'first',
        sandbox_name: null,
        detail: null,
      });
      db.insertEvent({
        timestamp: '2026-01-01T00:01:00Z',
        event_type: 'second',
        sandbox_name: null,
        detail: null,
      });
      const events = db.getRecentEvents(10);
      expect(events[0].event_type).toBe('second');
      expect(events[1].event_type).toBe('first');
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        db.insertEvent({
          timestamp: new Date().toISOString(),
          event_type: `event-${i}`,
          sandbox_name: null,
          detail: null,
        });
      }
      expect(db.getRecentEvents(3)).toHaveLength(3);
    });
  });

  describe('transactions', () => {
    it('commits on success', () => {
      db.transaction(() => {
        db.upsertSandbox({
          name: 'tx-sb',
          state: 'running',
          pid: 1,
          started_at: null,
          driver: null,
          sandbox_id: null,
          sandbox_user: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        });
      });
      expect(db.getSandbox('tx-sb')).toBeDefined();
    });

    it('rolls back on error', () => {
      try {
        db.transaction(() => {
          db.upsertSandbox({
            name: 'rollback-sb',
            state: 'running',
            pid: 1,
            started_at: null,
            driver: null,
            sandbox_id: null,
            sandbox_user: null,
            last_error: null,
            updated_at: new Date().toISOString(),
          });
          throw new Error('boom');
        });
      } catch {
        // expected
      }
      expect(db.getSandbox('rollback-sb')).toBeUndefined();
    });
  });
});
