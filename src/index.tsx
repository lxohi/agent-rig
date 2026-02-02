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
import { updateCommand } from './commands/update.js';
import { VERSION } from './version.js';

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

// Custom help text for main command
const MAIN_HELP = `Usage: arig [options] [command]

CLI tool for creating isolated development environments for coding agents

Options:
  -V, --version     Output the version number
  -h, --help        Display help for command

Sandbox Lifecycle:
  create <name>     Create a new sandbox from template
  list, ls          List all sandboxes with status
  start <name>      Start a stopped sandbox
  stop <name>       Stop a running sandbox
  destroy <name>    Delete a sandbox permanently

Sandbox Access:
  attach <name>     Attach to Claude Code tmux session
  ssh <name>        SSH into sandbox as agent_dev
  exec <name> ...   Execute command in sandbox
  info <name>       Show detailed sandbox info

Management:
  preset            Manage package presets
  template          Manage template cache

Other:
  update            Check for updates
  completions       Shell completions

Run 'arig <command> --help' for more information on a command.

Examples:
  $ arig create my-project --preset fullstack-dev
  $ arig attach my-project
  $ arig list
`;

program
  .name('arig')
  .description('CLI tool for creating isolated development environments for coding agents')
  .version(VERSION)
  .helpOption('-h, --help', 'Display help for command')
  .addHelpCommand(false)
  .action(() => {
    // Show custom help when no command is provided
    console.log(MAIN_HELP);
  });

// Override help for main program only
program.on('--help', () => {});
program.configureOutput({
  writeOut: (str) => {
    // Check if this is the main help output
    if (str.includes('Commands:') && str.includes('create [options]')) {
      process.stdout.write(MAIN_HELP);
    } else {
      process.stdout.write(str);
    }
  },
});

// ============================================
// Sandbox Lifecycle Commands (most common)
// ============================================

program
  .command('create <name>')
  .description('Create a new sandbox')
  .option('--repo <url>', 'Git repository URL (auto-detected from current directory)')
  .option('--git-user <user>', 'Git username for authentication')
  .option('--git-token <token>', 'Git personal access token')
  .option('--git-name <name>', 'Git commit author name (auto-detected from git config)')
  .option('--git-email <email>', 'Git commit author email (auto-detected from git config)')
  .option('--base-url <url>', 'Anthropic API base URL (from ANTHROPIC_BASE_URL env)')
  .option('--auth-token <token>', 'Anthropic auth token (from ANTHROPIC_AUTH_TOKEN env)')
  .option('--preset <name>', 'Use a preset')
  .option('--packages <list>', 'Comma-separated packages')
  .option('--save-preset <name>', 'Save configuration as a new preset')
  .option('--cpus <n>', 'CPU cores')
  .option('--memory <size>', 'Memory size')
  .option('--disk <size>', 'Disk size')
  .action(createCommand);

program
  .command('list')
  .alias('ls')
  .description('List all sandboxes with status')
  .action(listCommand);

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

// ============================================
// Sandbox Access Commands
// ============================================

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

program
  .command('info <name>')
  .description('Show detailed sandbox info')
  .action(infoCommand);

// ============================================
// Management Commands
// ============================================

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

const templateCmd = program.command('template').description('Template cache management');

templateCmd
  .command('list')
  .description('List cached templates')
  .action(templateListCommand);

templateCmd
  .command('prune [n]')
  .description('Keep only n most recent templates (default: 5)')
  .action(templatePruneCommand);

templateCmd
  .command('build')
  .description('Rebuild core template')
  .option('-f, --force', 'Force rebuild even if exists')
  .action(coreBuildCommand);

// ============================================
// Other Commands
// ============================================

program
  .command('update')
  .description('Check for updates and download if available')
  .action(updateCommand);

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
