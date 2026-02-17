import { spawn } from 'node:child_process';
import { logger } from '../../lib/logging.js';
import type { ExecRunResult } from '../../lib/runtime/daemon-protocol.js';

const DEFAULT_EXEC_TIMEOUT = 30_000;
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1 MB

export async function execRun(opts: {
  sandboxUser: string;
  command: string[];
  timeout?: number;
  env?: Record<string, string>;
}): Promise<ExecRunResult> {
  const { sandboxUser, command, env } = opts;
  const timeout = opts.timeout ?? DEFAULT_EXEC_TIMEOUT;

  return new Promise<ExecRunResult>((resolve, reject) => {
    const child = spawn('sudo', ['-u', sandboxUser, '--', ...command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (!stdoutTruncated) {
        stdout += chunk.toString();
        if (stdout.length > MAX_OUTPUT_SIZE) {
          stdout = stdout.slice(0, MAX_OUTPUT_SIZE);
          stdoutTruncated = true;
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (!stderrTruncated) {
        stderr += chunk.toString();
        if (stderr.length > MAX_OUTPUT_SIZE) {
          stderr = stderr.slice(0, MAX_OUTPUT_SIZE);
          stderrTruncated = true;
        }
      }
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code ?? (signal ? 128 : 1),
        stdout,
        stderr,
      });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}
