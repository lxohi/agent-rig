#!/usr/bin/env node
import { program } from 'commander';
import { checkAndSwap } from './lib/updater.js';
import { spawnBackgroundDownloader } from './lib/downloader.js';
import { listCommand } from './commands/list.js';
import { infoCommand } from './commands/info.js';
import { coreBuildCommand } from './commands/core.js';
import { createCommand } from './commands/create.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { destroyCommand } from './commands/destroy.js';
import { attachCommand } from './commands/attach.js';
import { sshCommand } from './commands/ssh.js';
import { execCommand } from './commands/exec.js';
import { templateListCommand, templatePruneCommand } from './commands/template.js';
import {
  presetListCommand,
  presetCreateCommand,
  presetDeleteCommand,
} from './commands/preset.js';
import {
  completionsBashCommand,
  completionsZshCommand,
  completionsInstallCommand,
} from './commands/completions.js';

// Check for updates (non-blocking)
checkAndSwap().then((result) => {
  if (result.swapped) {
    console.log(`Updated to v${result.newVersion}`);
  }
  if (result.checkTriggered) {
    spawnBackgroundDownloader();
  }
}).catch(() => {
  // Silently ignore update check errors
});

program
  .name('arig')
  .description('CLI tool for creating isolated development environments for coding agents')
  .version('0.2.0');

program
  .command('list')
  .alias('ls')
  .description('List all sandboxes with status')
  .action(listCommand);

program
  .command('info <name>')
  .description('Show detailed sandbox info')
  .action(infoCommand);

program
  .command('create <name>')
  .description('Create a new sandbox')
  .option('--repo <url>', 'Git repository URL')
  .option('--git-user <user>', 'Git username')
  .option('--git-token <token>', 'Git personal access token')
  .option('--preset <name>', 'Use a preset')
  .option('--packages <list>', 'Comma-separated packages')
  .option('--cpus <n>', 'CPU cores')
  .option('--memory <size>', 'Memory size')
  .option('--disk <size>', 'Disk size')
  .action(createCommand);

program
  .command('start <name>')
  .description('Start a stopped sandbox')
  .action(startCommand);

program
  .command('stop <name>')
  .description('Stop a running sandbox')
  .action(stopCommand);

program
  .command('destroy <name>')
  .description('Delete a sandbox permanently')
  .action(destroyCommand);

program
  .command('attach <name>')
  .description('Attach to Claude Code tmux session')
  .action(attachCommand);

program
  .command('ssh <name>')
  .description('SSH into sandbox as agent_dev')
  .action(sshCommand);

program
  .command('exec <name> <cmd...>')
  .description('Execute command in sandbox')
  .action(execCommand);

const coreCmd = program.command('core').description('Core template management');

coreCmd
  .command('build')
  .description('Build/rebuild core template')
  .option('-f, --force', 'Force rebuild even if exists')
  .action(coreBuildCommand);

const templateCmd = program.command('template').description('Template management');

templateCmd
  .command('list')
  .description('List cached templates')
  .action(templateListCommand);

templateCmd
  .command('prune [n]')
  .description('Keep only n most recent templates (default: 5)')
  .action(templatePruneCommand);

const presetCmd = program.command('preset').description('Preset management');

presetCmd
  .command('list')
  .description('List available presets')
  .action(presetListCommand);

presetCmd
  .command('create <name> <packages>')
  .description('Create a custom preset')
  .action(presetCreateCommand);

presetCmd
  .command('delete <name>')
  .description('Delete a custom preset')
  .action(presetDeleteCommand);

const completionsCmd = program.command('completions').description('Shell completions');

completionsCmd
  .command('install')
  .description('Install shell completions')
  .action(completionsInstallCommand);

completionsCmd
  .command('bash')
  .description('Output bash completions')
  .action(completionsBashCommand);

completionsCmd
  .command('zsh')
  .description('Output zsh completions')
  .action(completionsZshCommand);

program.parse();
