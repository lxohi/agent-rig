import { logger } from '../../lib/logging.js';
import type { StateDb, SandboxRow } from './state-db.js';

// ---------------------------------------------------------------------------
// Reconcile result
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  sandboxesChecked: number;
  portsChecked: number;
  orphansCleaned: number;
  errorsMarked: number;
  missingRebuilt: number;
}

export type ReconcileMode = 'full' | 'lightweight' | 'incremental';

// ---------------------------------------------------------------------------
// Process checker — abstracted for testability
// ---------------------------------------------------------------------------

export interface ProcessChecker {
  isRunning(pid: number): boolean;
}

export const defaultProcessChecker: ProcessChecker = {
  isRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// Reconciler
// ---------------------------------------------------------------------------

export class Reconciler {
  private db: StateDb;
  private processChecker: ProcessChecker;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(db: StateDb, processChecker?: ProcessChecker) {
    this.db = db;
    this.processChecker = processChecker ?? defaultProcessChecker;
  }

  reconcile(mode: ReconcileMode): ReconcileResult {
    const start = Date.now();
    logger.info('reconcile started', {
      component: 'reconciler',
      event: 'reconcile_start',
      mode,
    });

    const result: ReconcileResult = {
      sandboxesChecked: 0,
      portsChecked: 0,
      orphansCleaned: 0,
      errorsMarked: 0,
      missingRebuilt: 0,
    };

    this.db.transaction(() => {
      this.reconcileSandboxes(mode, result);
      // Re-read sandboxes after reconcileSandboxes may have updated state
      const sandboxes = this.db.listSandboxes();
      this.reconcilePortBindings(sandboxes, result);
      this.reconcileProxies(mode, result);
    });

    const elapsed = Date.now() - start;
    logger.info('reconcile completed', {
      component: 'reconciler',
      event: 'reconcile_done',
      mode,
      elapsed,
      ...result,
    });

    this.db.insertEvent({
      timestamp: new Date().toISOString(),
      event_type: `reconcile.${mode}`,
      sandbox_name: null,
      detail: JSON.stringify(result),
    });

    return result;
  }

  // -----------------------------------------------------------------------
  // Sandbox reconciliation
  // -----------------------------------------------------------------------

  private reconcileSandboxes(
    mode: ReconcileMode,
    result: ReconcileResult
  ): void {
    const sandboxes = this.db.listSandboxes();
    result.sandboxesChecked = sandboxes.length;

    for (const sb of sandboxes) {
      if (sb.state === 'running' && sb.pid != null) {
        if (!this.processChecker.isRunning(sb.pid)) {
          logger.warn('sandbox process not found, marking stopped', {
            component: 'reconciler',
            sandbox: sb.name,
            event: 'sandbox_drift',
            pid: sb.pid,
          });
          this.db.updateSandboxState(
            sb.name,
            'stopped',
            'Process not found during reconcile'
          );
          result.errorsMarked++;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Port binding reconciliation
  // -----------------------------------------------------------------------

  private reconcilePortBindings(
    sandboxes: SandboxRow[],
    result: ReconcileResult
  ): void {
    for (const sb of sandboxes) {
      const ports = this.db.getPortBindings(sb.name);
      result.portsChecked += ports.length;

      for (const port of ports) {
        if (port.status === 'active' && sb.state !== 'running') {
          logger.warn('active port on non-running sandbox', {
            component: 'reconciler',
            sandbox: sb.name,
            event: 'port_drift',
            portId: port.id,
          });
          this.db.updatePortBindingStatus(
            port.id,
            'error',
            'Sandbox not running'
          );
          result.errorsMarked++;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Proxy reconciliation
  // -----------------------------------------------------------------------

  private reconcileProxies(
    mode: ReconcileMode,
    result: ReconcileResult
  ): void {
    if (mode === 'lightweight') return;

    const proxies = this.db.getProxies();

    for (const proxy of proxies) {
      if (proxy.status === 'running' && proxy.pid != null) {
        if (!this.processChecker.isRunning(proxy.pid)) {
          logger.warn('proxy process not found, marking stopped', {
            component: 'reconciler',
            event: 'proxy_drift',
            proxyId: proxy.id,
            pid: proxy.pid,
          });
          this.db.upsertProxy({
            ...proxy,
            status: 'stopped',
            last_error: 'Process not found during reconcile',
          });
          result.orphansCleaned++;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Periodic scheduling
  // -----------------------------------------------------------------------

  startPeriodic(intervalMs = 60_000): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      try {
        this.reconcile('lightweight');
      } catch (err) {
        logger.error('periodic reconcile failed', {
          component: 'reconciler',
          event: 'reconcile_error',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }, intervalMs);

    logger.info('periodic reconcile scheduled', {
      component: 'reconciler',
      event: 'periodic_start',
      intervalMs,
    });
  }

  stopPeriodic(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('periodic reconcile stopped', {
        component: 'reconciler',
        event: 'periodic_stop',
      });
    }
  }
}
