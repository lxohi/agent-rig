#!/usr/bin/env node
import { program } from 'commander';
import { listCommand } from './commands/list.js';
import { infoCommand } from './commands/info.js';
import { coreBuildCommand } from './commands/core.js';

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

const coreCmd = program.command('core').description('Core template management');

coreCmd
  .command('build')
  .description('Build/rebuild core template')
  .option('-f, --force', 'Force rebuild even if exists')
  .action(coreBuildCommand);

program.parse();
