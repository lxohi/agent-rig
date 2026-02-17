#!/usr/bin/env node
import { program } from 'commander';
import { checkAndSwap } from './lib/updater.js';
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
import { setupCommand } from './commands/setup.js';
import { diagnoseCommand } from './commands/diagnose.js';
import { portAddCommand, portRemoveCommand, portListCommand } from './commands/port.js';
import {
  runtimeInitCommand,
  runtimeStatusCommand,
  runtimeUpgradeCommand,
  runtimeRepairCommand,
} from './commands/runtime.js';
import { VERSION } from './version.js';

// Check for updates and swap if pending (blocking)
try {
  const result = await checkAndSwap();
  if (result.swapped) {
    console.log(`Updated to v${result.newVersion}`);
  }
} catch {
  // Silently ignore update check errors
}

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
  port              Manage port mappings

Management:
  preset            Manage package presets
  template          Manage template cache
  runtime           Manage shared VM runtime

Other:
  setup             Install root helper and permissions (requires sudo)
  diagnose          Run system diagnostics and check configuration
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
// Port Mapping Commands
// ============================================

const portCmd = program.command('port').description('Manage port mappings');

portCmd
  .command('add <sandbox>')
  .description('Add a port mapping to a sandbox')
  .requiredOption('--host <port>', 'Host port number')
  .requiredOption('--target <port>', 'Target port in sandbox')
  .option('--bind <address>', 'Bind address (default: 127.0.0.1)')
  .option('--public', 'Bind to 0.0.0.0 (all interfaces)')
  .action(portAddCommand);

portCmd
  .command('remove <sandbox>')
  .description('Remove a port mapping from a sandbox')
  .requiredOption('--host <port>', 'Host port to remove')
  .action(portRemoveCommand);

portCmd
  .command('list <sandbox>')
  .description('List port mappings for a sandbox')
  .action(portListCommand);

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
  .description('[DEPRECATED] Rebuild core template — use "arig runtime init" instead')
  .option('-f, --force', 'Force rebuild even if exists')
  .action(async (opts: { force?: boolean }) => {
    console.warn(
      'Warning: "arig template build" is deprecated and will be removed in a future release.\n' +
      'Use "arig runtime init" for the new rootless sandbox architecture.\n',
    );
    await coreBuildCommand(opts);
  });

// ============================================
// Runtime Management Commands
// ============================================

const runtimeCmd = program.command('runtime').description('Manage shared VM runtime');

runtimeCmd
  .command('init')
  .description('Initialize shared VM (first-time setup)')
  .option('--cpus <n>', 'CPU cores for VM')
  .option('--memory <size>', 'Memory for VM (e.g. 4G)')
  .option('--disk <size>', 'Disk size for VM (e.g. 30G)')
  .option('--binary <path>', 'Path to Linux binary to deploy')
  .action(runtimeInitCommand);

runtimeCmd
  .command('status')
  .description('Show runtime health status')
  .action(runtimeStatusCommand);

runtimeCmd
  .command('upgrade')
  .description('Upgrade runtime binary in shared VM')
  .requiredOption('--binary <path>', 'Path to new Linux binary')
  .action(runtimeUpgradeCommand);

runtimeCmd
  .command('repair')
  .description('Repair shared VM runtime')
  .option('--binary <path>', 'Path to Linux binary to redeploy')
  .action(runtimeRepairCommand);

// ============================================
// Other Commands
// ============================================

program
  .command('setup')
  .description('Install root helper and permissions (requires sudo)')
  .action(setupCommand);

program
  .command('diagnose')
  .description('Run system diagnostics and check configuration')
  .action(diagnoseCommand);

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
