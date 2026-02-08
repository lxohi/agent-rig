import { randomUUID } from 'node:crypto';
import { logger } from '../../lib/logging.js';
import { PtySession, type PtySessionInfo } from './pty-session.js';
import type { StreamEndpoint } from '../../lib/runtime/daemon-protocol.js';
import { DAEMON_ERRORS } from '../../lib/runtime/daemon-protocol.js';

// ---------------------------------------------------------------------------
// Session manager — central registry for active PTY sessions
// ---------------------------------------------------------------------------

export interface CreateSessionOpts {
  sandboxName: string;
  sandboxUser: string;
  command: string[];
  env?: Record<string, string>;
}

export class SessionManager {
  private sessions = new Map<string, PtySession>();

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  async createSession(opts: CreateSessionOpts): Promise<PtySessionInfo> {
    const sessionId = randomUUID();

    const session = new PtySession({
      sessionId,
      sandboxName: opts.sandboxName,
      sandboxUser: opts.sandboxUser,
      command: opts.command,
      env: opts.env,
      onExit: () => this.handleSessionExit(sessionId),
    });

    this.sessions.set(sessionId, session);

    await session.start();

    logger.info('session created', {
      component: 'session-manager',
      event: 'session_create',
      sandbox: opts.sandboxName,
      sessionId,
    });

    return session.getInfo();
  }

  getSession(sessionId: string): PtySessionInfo | undefined {
    return this.sessions.get(sessionId)?.getInfo();
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    await session.destroy();
    this.sessions.delete(sessionId);

    logger.info('session destroyed', {
      component: 'session-manager',
      event: 'session_destroy',
      sessionId,
    });
  }

  listSessions(sandboxName?: string): PtySessionInfo[] {
    const all = Array.from(this.sessions.values()).map((s) => s.getInfo());
    if (sandboxName) {
      return all.filter((s) => s.sandboxName === sandboxName);
    }
    return all;
  }

  // -------------------------------------------------------------------------
  // Bulk cleanup
  // -------------------------------------------------------------------------

  async destroyAllForSandbox(sandboxName: string): Promise<number> {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.getInfo().sandboxName === sandboxName) {
        await session.destroy();
        this.sessions.delete(id);
        count++;
      }
    }
    if (count > 0) {
      logger.info('sessions cleaned for sandbox', {
        component: 'session-manager',
        event: 'sessions_cleanup',
        sandbox: sandboxName,
        count,
      });
    }
    return count;
  }

  async destroyAll(): Promise<void> {
    for (const [id, session] of this.sessions) {
      await session.destroy();
    }
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private handleSessionExit(sessionId: string): void {
    // Auto-cleanup exited sessions after a grace period
    setTimeout(() => {
      const session = this.sessions.get(sessionId);
      if (session && session.getState() === 'exited') {
        session.destroy().catch(() => {});
        this.sessions.delete(sessionId);
        logger.info('exited session auto-cleaned', {
          component: 'session-manager',
          event: 'session_auto_clean',
          sessionId,
        });
      }
    }, 30_000);
  }
}
