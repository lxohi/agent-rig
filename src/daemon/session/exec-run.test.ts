import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// Create mock child before importing the module
let mockChild: any;

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChild),
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

describe('execRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChild = createMockChild();
  });

  it('returns stdout/stderr/exitCode on success', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['echo', 'hello'],
    });

    mockChild.stdout.write('hello\n');
    mockChild.stdout.end();
    mockChild.stderr.end();
    mockChild.emit('exit', 0, null);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
  });

  it('captures stderr', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['failing-cmd'],
    });

    mockChild.stdout.end();
    mockChild.stderr.write('error msg\n');
    mockChild.stderr.end();
    mockChild.emit('exit', 1, null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('error msg\n');
  });

  it('returns 128 for signal kills', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['long-running'],
    });

    mockChild.stdout.end();
    mockChild.stderr.end();
    mockChild.emit('exit', null, 'SIGTERM');

    const result = await promise;
    expect(result.exitCode).toBe(128);
  });

  it('spawns with sudo command', async () => {
    const promise = execRun({
      sandboxUser: 'arig_sb_test',
      command: ['ls', '-la'],
    });

    expect(spawn).toHaveBeenCalledWith(
      'sudo',
      ['-u', 'arig_sb_test', '--', 'ls', '-la'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );

    mockChild.stdout.end();
    mockChild.stderr.end();
    mockChild.emit('exit', 0, null);
    await promise;
  });

  it('rejects on spawn error', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['bad-cmd'],
    });

    mockChild.emit('error', new Error('spawn failed'));

    await expect(promise).rejects.toThrow('spawn failed');
  });

  it('passes env to spawn', async () => {
    const promise = execRun({
      sandboxUser: 'testuser',
      command: ['env'],
      env: { FOO: 'bar' },
    });

    const callOpts = vi.mocked(spawn).mock.calls[0][2] as any;
    expect(callOpts.env.FOO).toBe('bar');

    mockChild.stdout.end();
    mockChild.stderr.end();
    mockChild.emit('exit', 0, null);
    await promise;
  });
});
