import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateDb } from './state-db.js';
import { Reconciler, type ProcessChecker } from './reconcile.js';

describe('Reconciler', () => {
  let testDir: string;
  let db: StateDb;
  let checker: ProcessChecker;
  let reconciler: Reconciler;
  let runningPids: Set<number>;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'reconcile-test-'));
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

  function insertSandbox(name: string, state: string, pid: number | null) {
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

  function insertPort(id: string, sandboxName: string, status: string) {
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

  function insertProxy(id: string, portBindingId: string, pid: number | null, status: string) {
    db.upsertProxy({
      id,
      port_binding_id: portBindingId,
      pid,
      status,
      started_at: pid ? '2026-01-01T00:00:00Z' : null,
      last_error: null,
    });
  }

  describe('full reconcile', () => {
    it('returns zero counts on empty db', () => {
      const result = reconciler.reconcile('full');
      expect(result.sandboxesChecked).toBe(0);
      expect(result.portsChecked).toBe(0);
      expect(result.orphansCleaned).toBe(0);
      expect(result.errorsMarked).toBe(0);
    });

    it('marks running sandbox as stopped when pid is dead', () => {
      insertSandbox('dead-sb', 'running', 9999);
      // pid 9999 is NOT in runningPids

      const result = reconciler.reconcile('full');
      expect(result.errorsMarked).toBe(1);

      const sb = db.getSandbox('dead-sb');
      expect(sb!.state).toBe('stopped');
      expect(sb!.last_error).toContain('not found');
    });

    it('leaves running sandbox alone when pid is alive', () => {
      insertSandbox('alive-sb', 'running', 5000);
      runningPids.add(5000);

      const result = reconciler.reconcile('full');
      expect(result.errorsMarked).toBe(0);

      const sb = db.getSandbox('alive-sb');
      expect(sb!.state).toBe('running');
    });

    it('skips stopped sandboxes', () => {
      insertSandbox('stopped-sb', 'stopped', null);

      const result = reconciler.reconcile('full');
      expect(result.sandboxesChecked).toBe(1);
      expect(result.errorsMarked).toBe(0);
    });
  });

  describe('port binding reconciliation', () => {
    it('marks active port as error when sandbox is not running', () => {
      insertSandbox('stopped-sb', 'stopped', null);
      insertPort('p1', 'stopped-sb', 'active');

      const result = reconciler.reconcile('full');
      expect(result.errorsMarked).toBeGreaterThanOrEqual(1);

      const ports = db.getPortBindings('stopped-sb');
      expect(ports[0].status).toBe('error');
      expect(ports[0].last_error).toContain('not running');
    });

    it('leaves active port alone when sandbox is running', () => {
      insertSandbox('running-sb', 'running', 5000);
      runningPids.add(5000);
      insertPort('p2', 'running-sb', 'active');

      const result = reconciler.reconcile('full');

      const ports = db.getPortBindings('running-sb');
      expect(ports[0].status).toBe('active');
    });

    it('leaves pending ports unchanged', () => {
      insertSandbox('sb', 'stopped', null);
      insertPort('p3', 'sb', 'pending');

      reconciler.reconcile('full');

      const ports = db.getPortBindings('sb');
      expect(ports[0].status).toBe('pending');
    });
  });

  describe('proxy reconciliation', () => {
    it('cleans orphan proxy with dead pid', () => {
      insertSandbox('sb', 'running', 5000);
      runningPids.add(5000);
      insertPort('p1', 'sb', 'active');
      insertProxy('proxy-1', 'p1', 7777, 'running');
      // pid 7777 is NOT in runningPids

      const result = reconciler.reconcile('full');
      expect(result.orphansCleaned).toBe(1);

      const proxies = db.getProxies();
      expect(proxies[0].status).toBe('stopped');
      expect(proxies[0].last_error).toContain('not found');
    });

    it('leaves running proxy with live pid alone', () => {
      insertSandbox('sb', 'running', 5000);
      runningPids.add(5000);
      insertPort('p1', 'sb', 'active');
      insertProxy('proxy-1', 'p1', 6000, 'running');
      runningPids.add(6000);

      const result = reconciler.reconcile('full');
      expect(result.orphansCleaned).toBe(0);
    });

    it('skips proxy check in lightweight mode', () => {
      insertSandbox('sb', 'running', 5000);
      runningPids.add(5000);
      insertPort('p1', 'sb', 'active');
      insertProxy('proxy-1', 'p1', 7777, 'running');

      const result = reconciler.reconcile('lightweight');
      // Proxy with dead pid should NOT be cleaned in lightweight mode
      expect(result.orphansCleaned).toBe(0);
    });
  });

  describe('event logging', () => {
    it('records reconcile event', () => {
      reconciler.reconcile('full');
      const events = db.getRecentEvents(10);
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].event_type).toBe('reconcile.full');
    });
  });

  describe('daemon restart recovery', () => {
    it('recovers correct state after simulated restart', () => {
      // Setup: sandbox was running with a port
      insertSandbox('restart-sb', 'running', 4000);
      insertPort('rp1', 'restart-sb', 'active');
      // pid 4000 is dead (simulating daemon crash)

      // Close and reopen db (simulating restart)
      db.close();
      db = new StateDb(join(testDir, 'state.db'));
      reconciler = new Reconciler(db, checker);

      const result = reconciler.reconcile('full');

      const sb = db.getSandbox('restart-sb');
      expect(sb!.state).toBe('stopped');

      const ports = db.getPortBindings('restart-sb');
      expect(ports[0].status).toBe('error');
    });
  });

  describe('periodic scheduling', () => {
    it('can start and stop periodic reconcile', () => {
      reconciler.startPeriodic(100_000);
      // Should not throw on double start
      reconciler.startPeriodic(100_000);
      reconciler.stopPeriodic();
      // Should not throw on double stop
      reconciler.stopPeriodic();
    });
  });
});
