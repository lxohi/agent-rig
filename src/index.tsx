#!/usr/bin/env node
import { program } from 'commander';

program
  .name('arig')
  .description('CLI tool for creating isolated development environments for coding agents')
  .version('0.1.0');

program.parse();
