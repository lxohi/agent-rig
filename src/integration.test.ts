import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI_PATH = join(process.cwd(), 'dist', 'index.js');

async function runCli(args: string[], env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execa('node', [CLI_PATH, ...args], {
      env: { ...process.env, ...env },
      reject: false,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  } catch (error: any) {
    return { stdout: error.stdout || '', stderr: error.stderr || '', exitCode: error.exitCode || 1 };
  }
}

describe('CLI Integration Tests', () => {
  describe('Help and Version', () => {
    it('shows help with --help', async () => {
      const { stdout, exitCode } = await runCli(['--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('CLI tool for creating isolated development environments');
      expect(stdout).toContain('create');
      expect(stdout).toContain('list');
      expect(stdout).toContain('start');
      expect(stdout).toContain('stop');
    });

    it('shows version with --version', async () => {
      const { stdout, exitCode } = await runCli(['--version']);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('List Command', () => {
    it('lists sandboxes (empty initially)', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['list'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(0);
        expect(stdout).toContain('No sandboxes found');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('ls alias works', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['ls'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(0);
        expect(stdout).toContain('No sandboxes found');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Info Command', () => {
    it('shows error for non-existent sandbox', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['info', 'nonexistent'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(1);
        expect(stdout).toContain('not found');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Preset Commands', () => {
    it('lists default presets', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['preset', 'list'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(0);
        expect(stdout).toContain('fullstack-dev');
        expect(stdout).toContain('python-ml');
        expect(stdout).toContain('frontend');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('creates a custom preset', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(
          ['preset', 'create', 'my-preset', 'node-20,python-312'],
          { ARIG_CONFIG_DIR: testDir }
        );
        expect(exitCode).toBe(0);
        expect(stdout).toContain('Created preset');

        // Verify it appears in list
        const { stdout: listOutput } = await runCli(['preset', 'list'], { ARIG_CONFIG_DIR: testDir });
        expect(listOutput).toContain('my-preset');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('prevents deleting built-in presets', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(
          ['preset', 'delete', 'fullstack-dev'],
          { ARIG_CONFIG_DIR: testDir }
        );
        expect(exitCode).toBe(1);
        expect(stdout).toContain('Cannot delete built-in preset');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('deletes a custom preset', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        // Create preset first
        await runCli(['preset', 'create', 'to-delete', 'node-20'], { ARIG_CONFIG_DIR: testDir });

        // Delete it
        const { stdout, exitCode } = await runCli(
          ['preset', 'delete', 'to-delete'],
          { ARIG_CONFIG_DIR: testDir }
        );
        expect(exitCode).toBe(0);
        expect(stdout).toContain('Deleted preset');

        // Verify it's gone
        const { stdout: listOutput } = await runCli(['preset', 'list'], { ARIG_CONFIG_DIR: testDir });
        expect(listOutput).not.toContain('to-delete');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Template Commands', () => {
    it('lists templates (empty initially)', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['template', 'list'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(0);
        expect(stdout).toContain('No cached templates');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('prune with no templates does nothing', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['template', 'prune'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(0);
        expect(stdout).toContain('Nothing to prune');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Completions Commands', () => {
    it('outputs bash completions', async () => {
      const { stdout, exitCode } = await runCli(['completions', 'bash']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('_arig_completions');
      expect(stdout).toContain('complete -F');
    });

    it('outputs zsh completions', async () => {
      const { stdout, exitCode } = await runCli(['completions', 'zsh']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('#compdef arig');
      expect(stdout).toContain('_arig');
    });
  });

  describe('Core Command', () => {
    it('shows help for core subcommand', async () => {
      const { stdout, exitCode } = await runCli(['core', '--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('build');
      expect(stdout).toContain('Core template management');
    });
  });

  describe('Start/Stop/Destroy Commands', () => {
    it('start shows error for non-existent sandbox', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['start', 'nonexistent'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(1);
        expect(stdout).toContain('not found');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('stop shows error for non-existent sandbox', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['stop', 'nonexistent'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(1);
        expect(stdout).toContain('not found');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('destroy shows error for non-existent sandbox', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['destroy', 'nonexistent'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(1);
        expect(stdout).toContain('not found');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Create Command', () => {
    it('shows error for non-existent preset', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(
          ['create', 'test-sandbox', '--preset', 'nonexistent', '--repo', 'https://github.com/test/repo'],
          { ARIG_CONFIG_DIR: testDir }
        );
        expect(exitCode).toBe(1);
        expect(stdout).toContain('Preset "nonexistent" not found');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Attach/SSH/Exec Commands', () => {
    it('attach shows error for non-existent sandbox', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['attach', 'nonexistent'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(1);
        expect(stdout).toContain('not found');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('ssh shows error for non-existent sandbox', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['ssh', 'nonexistent'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(1);
        expect(stdout).toContain('not found');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('exec shows error for non-existent sandbox', async () => {
      const testDir = await mkdtemp(join(tmpdir(), 'arig-test-'));
      try {
        const { stdout, exitCode } = await runCli(['exec', 'nonexistent', 'ls'], { ARIG_CONFIG_DIR: testDir });
        expect(exitCode).toBe(1);
        expect(stdout).toContain('not found');
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });
});
