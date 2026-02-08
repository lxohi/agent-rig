import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from './session-manager.js';

// Mock PtySession to avoid spawning real processes
vi.mock('./pty-session.js', () => {
  let sessionCounter = 0;

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

    getState() {
      return this.state;
    }

    getExitCode() {
      return this.exitCode;
    }

    // Test helper to simulate exit
    simulateExit(code: number) {
      this.exitCode = code;
      this.state = 'exited';
      this.onExitCb?.();
    }
  }

  return { PtySession: MockPtySession };
});

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  afterEach(async () => {
    await manager.destroyAll();
  });

  describe('createSession', () => {
    it('creates a session and returns info', async () => {
      const info = await manager.createSession({
        sandboxName: 'test-sb',
        sandboxUser: 'arig_sb_test',
        command: ['bash', '-l'],
      });

      expect(info.sessionId).toBeDefined();
      expect(info.sandboxName).toBe('test-sb');
      expect(info.command).toEqual(['bash', '-l']);
      expect(info.state).toBe('running');
      expect(info.streamEndpoint).toBeDefined();
      expect(info.streamEndpoint.transport).toBe('unix-socket');
      expect(info.streamEndpoint.token).toBeDefined();
    });

    it('assigns unique session IDs', async () => {
      const s1 = await manager.createSession({
        sandboxName: 'sb1',
        sandboxUser: 'u1',
        command: ['bash'],
      });
      const s2 = await manager.createSession({
        sandboxName: 'sb2',
        sandboxUser: 'u2',
        command: ['bash'],
      });

      expect(s1.sessionId).not.toBe(s2.sessionId);
    });

    it('increments size on create', async () => {
      expect(manager.size).toBe(0);

      await manager.createSession({
        sandboxName: 'sb',
        sandboxUser: 'u',
        command: ['bash'],
      });

      expect(manager.size).toBe(1);
    });
  });

  describe('getSession', () => {
    it('returns session info by ID', async () => {
      const created = await manager.createSession({
        sandboxName: 'test-sb',
        sandboxUser: 'u',
        command: ['ls'],
      });

      const retrieved = manager.getSession(created.sessionId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.sessionId).toBe(created.sessionId);
      expect(retrieved!.sandboxName).toBe('test-sb');
    });

    it('returns undefined for unknown ID', () => {
      expect(manager.getSession('nonexistent')).toBeUndefined();
    });
  });

  describe('destroySession', () => {
    it('removes session from registry', async () => {
      const info = await manager.createSession({
        sandboxName: 'sb',
        sandboxUser: 'u',
        command: ['bash'],
      });

      await manager.destroySession(info.sessionId);
      expect(manager.getSession(info.sessionId)).toBeUndefined();
      expect(manager.size).toBe(0);
    });

    it('is a no-op for unknown ID', async () => {
      await expect(manager.destroySession('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('listSessions', () => {
    it('returns all sessions', async () => {
      await manager.createSession({
        sandboxName: 'sb1',
        sandboxUser: 'u1',
        command: ['bash'],
      });
      await manager.createSession({
        sandboxName: 'sb2',
        sandboxUser: 'u2',
        command: ['sh'],
      });

      const all = manager.listSessions();
      expect(all).toHaveLength(2);
    });

    it('filters by sandbox name', async () => {
      await manager.createSession({
        sandboxName: 'sb1',
        sandboxUser: 'u1',
        command: ['bash'],
      });
      await manager.createSession({
        sandboxName: 'sb2',
        sandboxUser: 'u2',
        command: ['sh'],
      });
      await manager.createSession({
        sandboxName: 'sb1',
        sandboxUser: 'u1',
        command: ['ls'],
      });

      const filtered = manager.listSessions('sb1');
      expect(filtered).toHaveLength(2);
      expect(filtered.every((s) => s.sandboxName === 'sb1')).toBe(true);
    });

    it('returns empty array when no sessions', () => {
      expect(manager.listSessions()).toEqual([]);
    });
  });

  describe('destroyAllForSandbox', () => {
    it('destroys only sessions for the given sandbox', async () => {
      await manager.createSession({
        sandboxName: 'sb1',
        sandboxUser: 'u1',
        command: ['bash'],
      });
      await manager.createSession({
        sandboxName: 'sb2',
        sandboxUser: 'u2',
        command: ['bash'],
      });
      await manager.createSession({
        sandboxName: 'sb1',
        sandboxUser: 'u1',
        command: ['sh'],
      });

      const count = await manager.destroyAllForSandbox('sb1');
      expect(count).toBe(2);
      expect(manager.size).toBe(1);
      expect(manager.listSessions('sb1')).toHaveLength(0);
      expect(manager.listSessions('sb2')).toHaveLength(1);
    });

    it('returns 0 when no sessions match', async () => {
      const count = await manager.destroyAllForSandbox('nonexistent');
      expect(count).toBe(0);
    });
  });

  describe('destroyAll', () => {
    it('clears all sessions', async () => {
      await manager.createSession({
        sandboxName: 'sb1',
        sandboxUser: 'u1',
        command: ['bash'],
      });
      await manager.createSession({
        sandboxName: 'sb2',
        sandboxUser: 'u2',
        command: ['bash'],
      });

      await manager.destroyAll();
      expect(manager.size).toBe(0);
      expect(manager.listSessions()).toEqual([]);
    });
  });
});
