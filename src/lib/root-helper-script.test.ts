import { describe, it, expect } from 'vitest';
import { ROOT_HELPER_SCRIPT } from './root-helper-script.js';
import { SUDOERS_TEMPLATE, ROOT_HELPER_PATH, SUDOERS_DROP_IN_PATH, ARIG_GROUP } from './sudoers-template.js';

describe('root-helper-script', () => {
  it('starts with bash shebang', () => {
    expect(ROOT_HELPER_SCRIPT.startsWith('#!/bin/bash')).toBe(true);
  });

  it('uses set -euo pipefail', () => {
    expect(ROOT_HELPER_SCRIPT).toContain('set -euo pipefail');
  });

  it('contains the username validation pattern', () => {
    expect(ROOT_HELPER_SCRIPT).toContain("'^arig_sb_[a-z0-9_-]+$'");
  });

  it('contains all four subcommand functions', () => {
    expect(ROOT_HELPER_SCRIPT).toContain('cmd_create_user()');
    expect(ROOT_HELPER_SCRIPT).toContain('cmd_delete_user()');
    expect(ROOT_HELPER_SCRIPT).toContain('cmd_ensure_slice()');
    expect(ROOT_HELPER_SCRIPT).toContain('cmd_cleanup_resources()');
  });

  it('contains all four case dispatch entries', () => {
    expect(ROOT_HELPER_SCRIPT).toContain('create-user)');
    expect(ROOT_HELPER_SCRIPT).toContain('delete-user)');
    expect(ROOT_HELPER_SCRIPT).toContain('ensure-slice)');
    expect(ROOT_HELPER_SCRIPT).toContain('cleanup-resources)');
  });

  it('contains audit logging function', () => {
    expect(ROOT_HELPER_SCRIPT).toContain('audit()');
    expect(ROOT_HELPER_SCRIPT).toContain('AUDIT_LOG=');
  });

  it('preserves bash ${} variable expansion syntax', () => {
    expect(ROOT_HELPER_SCRIPT).toContain('${SUDO_UID:-');
    expect(ROOT_HELPER_SCRIPT).toContain('${SUDO_USER:-');
    expect(ROOT_HELPER_SCRIPT).toContain('${username}.slice');
  });

  it('preserves bash $() subshell syntax', () => {
    expect(ROOT_HELPER_SCRIPT).toContain('$(date -u');
    expect(ROOT_HELPER_SCRIPT).toContain('$(id -u)');
    expect(ROOT_HELPER_SCRIPT).toContain('$(whoami)');
  });

  it('contains idempotency checks', () => {
    expect(ROOT_HELPER_SCRIPT).toContain('already exists (idempotent)');
    expect(ROOT_HELPER_SCRIPT).toContain('does not exist (idempotent)');
  });
});

describe('sudoers-template', () => {
  it('restricts to %arig group', () => {
    const lines = SUDOERS_TEMPLATE.split('\n').filter(l => l.startsWith('%'));
    expect(lines.length).toBe(4);
    for (const line of lines) {
      expect(line).toMatch(/^%arig /);
    }
  });

  it('only allows the four whitelisted subcommands', () => {
    const commands = ['create-user', 'delete-user', 'ensure-slice', 'cleanup-resources'];
    const ruleLines = SUDOERS_TEMPLATE.split('\n').filter(l => l.startsWith('%'));
    expect(ruleLines).toHaveLength(commands.length);
    for (const cmd of commands) {
      expect(ruleLines.some(l => l.includes(cmd))).toBe(true);
    }
  });

  it('restricts username argument to arig_sb_* prefix', () => {
    const ruleLines = SUDOERS_TEMPLATE.split('\n').filter(l => l.startsWith('%'));
    for (const line of ruleLines) {
      expect(line).toContain('arig_sb_*');
    }
  });

  it('uses NOPASSWD for all rules', () => {
    const ruleLines = SUDOERS_TEMPLATE.split('\n').filter(l => l.startsWith('%'));
    for (const line of ruleLines) {
      expect(line).toContain('NOPASSWD:');
    }
  });

  it('points to the correct helper binary path', () => {
    expect(SUDOERS_TEMPLATE).toContain(ROOT_HELPER_PATH);
  });

  it('exports correct constants', () => {
    expect(ROOT_HELPER_PATH).toBe('/usr/local/libexec/arigd-root-helper');
    expect(SUDOERS_DROP_IN_PATH).toBe('/etc/sudoers.d/arigd-root-helper');
    expect(ARIG_GROUP).toBe('arig');
  });
});
