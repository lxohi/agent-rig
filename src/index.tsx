#!/usr/bin/env node
import { program } from 'commander';
import { listCommand } from './commands/list.js';
import { infoCommand } from './commands/info.js';
import { coreBuildCommand } from './commands/core.js';
import { createCommand } from './commands/create.js';

program
  .name('arig')
  .description('CLI tool for creating isolated development environments for coding agents')
  .version('0.1.0');

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

const coreCmd = program.command('core').description('Core template management');

coreCmd
  .command('build')
  .description('Build/rebuild core template')
  .option('-f, --force', 'Force rebuild even if exists')
  .action(coreBuildCommand);

program.parse();
