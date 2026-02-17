import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateDb } from './state-db.js';
import { Reconciler, type ProcessChecker } from './reconcile.js';

describe('Reconciler edge cases', () => {
  let testDir: string;
  let db: StateDb;
  let checker: ProcessChecker;
  let reconciler: Reconciler;
  let runningPids: Set<number>;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'reconcile-edge-'));
    db = new StateDb(join(testDir, 'state.db'));
    runningPids = new Set();
    checker = { isRunning: (pid) => runningPids.has(pid) };
    reconciler = new Reconciler(db, checker);
  });

  afterEach(async () => {
    reconciler.stopPeriodic();
    db.close();
    await rm(testDir, { recursive: true, force: true });
  });

  function insertSandbox(
    name: string,
    state: string,
    pid: number | null
  ) {
    db.upsertSandbox({
      name,
      state,
      pid,
      started_at: pid ? '2026-01-01T00:00:00Z' : null,
      driver: 'linux-rootless',
      sandbox_id: `sb-${name}`,
      sandbox_user: `user-${name}`,
      last_error: null,
      updated_at: '2026-01-01T00:00:00Z',
    });
  }

  function insertPort(
    id: string,
    sandboxName: string,
    status: string
  ) {
    db.upsertPortBinding({
      id,
      sandbox_name: sandboxName,
      host_port: 8080,
      target_port: 80,
      protocol: 'tcp',
      bind_address: '127.0.0.1',
      status,
      created_at: '2026-01-01T00:00:00Z',
      last_error: null,
    });
  }

  describe('reconcile with empty database', () => {
    it('full reconcile on empty db completes without error', () => {
      const result = reconciler.reconcile('full');
      expect(result.sandboxesChecked).toBe(0);
      expect(result.portsChecked).toBe(0);
      expect(result.orphansCleaned).toBe(0);
      expect(result.errorsMarked).toBe(0);
      expect(result.missingRebuilt).toBe(0);
    });

    it('lightweight reconcile on empty db completes without error', () => {
      const result = reconciler.reconcile('lightweight');
      expect(result.sandboxesChecked).toBe(0);
    });

    it('incremental reconcile on empty db completes without error', () => {
      const result = reconciler.reconcile('incremental');
      expect(result.sandboxesChecked).toBe(0);
    });
  });

  describe('multiple sandboxes with mixed states', () => {
    it('correctly handles mix of running/stopped/broken sandboxes', () => {
      insertSandbox('running-1', 'running', 1000);
      insertSandbox('running-2', 'running', 2000);
      insertSandbox('stopped-1', 'stopped', null);
      insertSandbox('broken-1', 'broken', null);

      runningPids.add(1000); // running-1 is alive
      // running-2 pid 2000 is dead

      const result = reconciler.reconcile('full');
      expect(result.sandboxesChecked).toBe(4);
      expect(result.errorsMarked).toBe(1); // only running-2

      expect(db.getSandbox('running-1')!.state).toBe('running');
      expect(db.getSandbox('running-2')!.state).toBe('stopped');
      expect(db.getSandbox('stopped-1')!.state).toBe('stopped');
      expect(db.getSandbox('broken-1')!.state).toBe('broken');
    });
  });

  describe('port drift with multiple ports per sandbox', () => {
    it('marks all active ports as error when sandbox stops', () => {
      insertSandbox('sb', 'stopped', null);
      insertPort('p1', 'sb', 'active');
      insertPort('p2', 'sb', 'active');
      insertPort('p3', 'sb', 'pending');

      const result = reconciler.reconcile('full');

      const ports = db.getPortBindings('sb');
      const activeErrors = ports.filter(
        (p) => p.status === 'error'
      );
      const pending = ports.filter((p) => p.status === 'pending');

      expect(activeErrors).toHaveLength(2);
      expect(pending).toHaveLength(1);
      expect(result.errorsMarked).toBe(2);
    });
  });

  describe('idempotent reconciliation', () => {
    it('running reconcile twice produces same result', () => {
      insertSandbox('sb', 'running', 9999);
      insertPort('p1', 'sb', 'active');

      const result1 = reconciler.reconcile('full');
      expect(result1.errorsMarked).toBe(2); // sandbox + port

      // Second reconcile — sandbox is now stopped, port is error
      const result2 = reconciler.reconcile('full');
      expect(result2.errorsMarked).toBe(0); // already corrected
    });
  });

  describe('reconcile after sandbox delete', () => {
    it('handles sandbox deleted between reconcile runs', () => {
      insertSandbox('temp-sb', 'running', 3000);
      runningPids.add(3000);
      insertPort('tp1', 'temp-sb', 'active');

      reconciler.reconcile('full');
      expect(db.getSandbox('temp-sb')!.state).toBe('running');

      // Delete sandbox (FK cascade removes ports)
      db.deleteSandbox('temp-sb');

      // Reconcile should handle the missing sandbox gracefully
      const result = reconciler.reconcile('full');
      expect(result.sandboxesChecked).toBe(0);
      expect(result.portsChecked).toBe(0);
    });
  });

  describe('event audit trail', () => {
    it('records events for each reconcile mode', () => {
      reconciler.reconcile('full');
      reconciler.reconcile('lightweight');

      const events = db.getRecentEvents(10);
      const types = events.map((e) => e.event_type);
      expect(types).toContain('reconcile.full');
      expect(types).toContain('reconcile.lightweight');
    });

    it('event detail contains result counts', () => {
      insertSandbox('sb', 'running', 9999);

      reconciler.reconcile('full');

      const events = db.getRecentEvents(1);
      const detail = JSON.parse(events[0].detail!);
      expect(detail.sandboxesChecked).toBe(1);
      expect(detail.errorsMarked).toBe(1);
    });
  });

  describe('process checker edge cases', () => {
    it('handles sandbox with pid=0', () => {
      // pid 0 is special (kernel), should not be in runningPids
      insertSandbox('sb-zero', 'running', 0);

      const result = reconciler.reconcile('full');
      // pid 0 is not in runningPids, so it should be marked stopped
      expect(result.errorsMarked).toBe(1);
    });

    it('handles sandbox with null pid in running state', () => {
      // Edge case: running state but no pid recorded
      insertSandbox('sb-nopid', 'running', null);

      const result = reconciler.reconcile('full');
      // Should not crash — pid is null so the check is skipped
      expect(result.errorsMarked).toBe(0);
    });
  });
});
