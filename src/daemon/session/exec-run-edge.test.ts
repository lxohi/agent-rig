import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

let mockChild: any;

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

vi.mock('../../lib/logging.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { spawn } from 'node:child_process';
import { execRun } from './exec-run.js';

function createMockChild() {
  const child = new EventEmitter() as any;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.kill = vi.fn(() => { child.killed = true; });
  return child;
}

describe('execRun edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockChild = createMockChild();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('truncates stdout exceeding 1MB', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['generate-large-output'],
    });

    // Write 1.5MB of data in chunks
    const chunkSize = 256 * 1024; // 256KB
    for (let i = 0; i < 6; i++) {
      mockChild.stdout.write(Buffer.alloc(chunkSize, 0x41)); // 'A'
    }
    mockChild.stdout.end();
    mockChild.stderr.end();
    mockChild.emit('exit', 0, null);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    // Output should be truncated to 1MB
    expect(result.stdout.length).toBe(1024 * 1024);
  });

  it('truncates stderr exceeding 1MB', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['noisy-cmd'],
    });

    // Write 1.5MB of stderr
    const chunkSize = 256 * 1024;
    for (let i = 0; i < 6; i++) {
      mockChild.stderr.write(Buffer.alloc(chunkSize, 0x45)); // 'E'
    }
    mockChild.stdout.end();
    mockChild.stderr.end();
    mockChild.emit('exit', 1, null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.stderr.length).toBe(1024 * 1024);
  });

  it('times out after custom timeout and kills process', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['sleep', '999'],
      timeout: 500,
    });

    // Advance past the timeout
    vi.advanceTimersByTime(600);

    await expect(promise).rejects.toThrow('Command timed out after 500ms');
    expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('times out after default 30s timeout', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['sleep', '999'],
    });

    vi.advanceTimersByTime(31_000);

    await expect(promise).rejects.toThrow('Command timed out after 30000ms');
    expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('ignores exit event after timeout (settled flag)', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['sleep', '999'],
      timeout: 100,
    });

    vi.advanceTimersByTime(200);

    // Exit event arrives after timeout — should be ignored
    mockChild.emit('exit', 0, null);

    await expect(promise).rejects.toThrow('Command timed out');
  });

  it('ignores error event after exit (settled flag)', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['cmd'],
    });

    // Exit first
    mockChild.emit('exit', 0, null);
    // Then error arrives — should be ignored
    mockChild.emit('error', new Error('late error'));

    const result = await promise;
    expect(result.exitCode).toBe(0);
  });

  it('returns exitCode 1 when exit has null code and no signal', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['weird-exit'],
    });

    mockChild.stdout.end();
    mockChild.stderr.end();
    mockChild.emit('exit', null, null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it('handles concurrent exec calls independently', async () => {
    const child1 = createMockChild();
    const child2 = createMockChild();
    vi.mocked(spawn)
      .mockReturnValueOnce(child1 as any)
      .mockReturnValueOnce(child2 as any);

    const p1 = execRun({ sandboxUser: 'u1', command: ['cmd1'] });
    const p2 = execRun({ sandboxUser: 'u2', command: ['cmd2'] });

    child1.stdout.write('out1');
    child1.stdout.end();
    child1.stderr.end();
    child1.emit('exit', 0, null);

    child2.stderr.write('err2');
    child2.stdout.end();
    child2.stderr.end();
    child2.emit('exit', 42, null);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.exitCode).toBe(0);
    expect(r1.stdout).toBe('out1');
    expect(r2.exitCode).toBe(42);
    expect(r2.stderr).toBe('err2');
  });

  it('stops collecting stdout after truncation', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['big-output'],
    });

    // Write exactly 1MB
    mockChild.stdout.write(Buffer.alloc(1024 * 1024, 0x41));
    // Write more — should be ignored
    mockChild.stdout.write(Buffer.alloc(1024, 0x42));
    mockChild.stdout.end();
    mockChild.stderr.end();
    mockChild.emit('exit', 0, null);

    const result = await promise;
    // Should be exactly 1MB, no extra data
    expect(result.stdout.length).toBe(1024 * 1024);
    // All characters should be 'A' (0x41), none 'B' (0x42)
    expect(result.stdout.includes('B')).toBe(false);
  });
});
