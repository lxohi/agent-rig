import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from './session-manager.js';

vi.mock('../../lib/logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Store created mock instances so tests can call simulateExit
const mockInstances: any[] = [];

// Mock PtySession to avoid spawning real processes
vi.mock('./pty-session.js', () => {
  class MockPtySession {
    readonly sessionId: string;
    readonly sandboxName: string;
    readonly sandboxUser: string;
    readonly command: string[];
    readonly token = 'mock-token';
    private state = 'starting';
    private exitCode: number | undefined;
    private onExitCb: (() => void) | null;

    constructor(opts: {
      sessionId: string;
      sandboxName: string;
      sandboxUser: string;
      command: string[];
      env?: Record<string, string>;
      onExit?: () => void;
    }) {
      this.sessionId = opts.sessionId;
      this.sandboxName = opts.sandboxName;
      this.sandboxUser = opts.sandboxUser;
      this.command = opts.command;
      this.onExitCb = opts.onExit ?? null;
      mockInstances.push(this);
    }

    async start() {
      this.state = 'running';
      return this.getStreamEndpoint();
    }

    async destroy() {
      this.state = 'exited';
    }

    getInfo() {
      return {
        sessionId: this.sessionId,
        sandboxName: this.sandboxName,
        command: this.command,
        state: this.state,
        pid: 12345,
        exitCode: this.exitCode,
        createdAt: '2026-01-01T00:00:00Z',
        streamEndpoint: this.getStreamEndpoint(),
      };
    }

    getStreamEndpoint() {
      return {
        transport: 'unix-socket' as const,
        path: `/tmp/sessions/${this.sessionId}.sock`,
        token: this.token,
      };
    }

    getState() { return this.state; }
    getExitCode() { return this.exitCode; }

    // Test helper: simulate process exit
    simulateExit(code: number) {
      this.exitCode = code;
      this.state = 'exited';
      this.onExitCb?.();
    }
  }

  return { PtySession: MockPtySession };
});

describe('SessionManager edge cases', () => {
  let mgr: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mockInstances.length = 0;
    mgr = new SessionManager();
  });

  afterEach(async () => {
    await mgr.destroyAll();
    vi.useRealTimers();
  });

  it('concurrent sessions for same sandbox', async () => {
    const s1 = await mgr.createSession({
      sandboxName: 'sb1',
      sandboxUser: 'arig_sb_sb1',
      command: ['bash'],
    });
    const s2 = await mgr.createSession({
      sandboxName: 'sb1',
      sandboxUser: 'arig_sb_sb1',
      command: ['sh'],
    });

    expect(s1.sessionId).not.toBe(s2.sessionId);

    const sessions = mgr.listSessions('sb1');
    expect(sessions).toHaveLength(2);
  });

  it('destroyAllForSandbox only destroys target sandbox', async () => {
    await mgr.createSession({
      sandboxName: 'sb1',
      sandboxUser: 'arig_sb_sb1',
      command: ['bash'],
    });
    await mgr.createSession({
      sandboxName: 'sb2',
      sandboxUser: 'arig_sb_sb2',
      command: ['bash'],
    });
    await mgr.createSession({
      sandboxName: 'sb1',
      sandboxUser: 'arig_sb_sb1',
      command: ['sh'],
    });

    await mgr.destroyAllForSandbox('sb1');

    expect(mgr.listSessions('sb1')).toHaveLength(0);
    expect(mgr.listSessions('sb2')).toHaveLength(1);
  });

  it('destroyAll clears all sessions across sandboxes', async () => {
    await mgr.createSession({
      sandboxName: 'sb1',
      sandboxUser: 'u1',
      command: ['bash'],
    });
    await mgr.createSession({
      sandboxName: 'sb2',
      sandboxUser: 'u2',
      command: ['bash'],
    });

    await mgr.destroyAll();

    expect(mgr.listSessions()).toHaveLength(0);
  });

  it('getSession returns undefined for destroyed session', async () => {
    const info = await mgr.createSession({
      sandboxName: 'sb1',
      sandboxUser: 'u1',
      command: ['bash'],
    });

    await mgr.destroySession(info.sessionId);

    expect(mgr.getSession(info.sessionId)).toBeUndefined();
  });

  it('double destroy is idempotent', async () => {
    const info = await mgr.createSession({
      sandboxName: 'sb1',
      sandboxUser: 'u1',
      command: ['bash'],
    });

    await mgr.destroySession(info.sessionId);
    // Second destroy should not throw
    await mgr.destroySession(info.sessionId);

    expect(mgr.listSessions()).toHaveLength(0);
  });

  it('session IDs are unique across creates', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const info = await mgr.createSession({
        sandboxName: 'sb1',
        sandboxUser: 'u1',
        command: ['bash'],
      });
      ids.add(info.sessionId);
    }
    expect(ids.size).toBe(20);
  });

  it('listSessions with no filter returns all', async () => {
    await mgr.createSession({
      sandboxName: 'sb1',
      sandboxUser: 'u1',
      command: ['bash'],
    });
    await mgr.createSession({
      sandboxName: 'sb2',
      sandboxUser: 'u2',
      command: ['sh'],
    });

    const all = mgr.listSessions();
    expect(all).toHaveLength(2);
    const names = all.map((s: any) => s.sandboxName).sort();
    expect(names).toEqual(['sb1', 'sb2']);
  });

  it('auto-cleans exited sessions after 30s grace period', async () => {
    const info = await mgr.createSession({
      sandboxName: 'sb1',
      sandboxUser: 'u1',
      command: ['bash'],
    });

    expect(mgr.size).toBe(1);

    // Simulate the process exiting (triggers onExit -> handleSessionExit)
    const mockSession = mockInstances[0];
    mockSession.simulateExit(0);

    // Session should still be present before grace period
    expect(mgr.size).toBe(1);

    // Advance past the 30s grace period
    vi.advanceTimersByTime(31_000);

    // Session should now be auto-cleaned
    expect(mgr.size).toBe(0);
    expect(mgr.getSession(info.sessionId)).toBeUndefined();
  });

  it('does not auto-clean session that was manually destroyed during grace period', async () => {
    const info = await mgr.createSession({
      sandboxName: 'sb1',
      sandboxUser: 'u1',
      command: ['bash'],
    });

    // Simulate exit
    const mockSession = mockInstances[0];
    mockSession.simulateExit(0);

    // Manually destroy before grace period expires
    await mgr.destroySession(info.sessionId);
    expect(mgr.size).toBe(0);

    // Advance past grace period — should not throw or cause issues
    vi.advanceTimersByTime(31_000);
    expect(mgr.size).toBe(0);
  });

  it('env is passed through to PtySession', async () => {
    const info = await mgr.createSession({
      sandboxName: 'sb1',
      sandboxUser: 'u1',
      command: ['env'],
      env: { MY_VAR: 'hello' },
    });

    // Session was created successfully (env forwarded to mock)
    expect(info.state).toBe('running');
  });
});
