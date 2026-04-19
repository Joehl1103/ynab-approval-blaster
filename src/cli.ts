#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('ynab-blaster')
  .description('Rip through YNAB unapproved transactions with single keystrokes')
  .version('0.1.0');

program
  .command('init')
  .description('First-time setup: configure PAT and budget')
  .action(async () => {
    const { runInit } = await import('./commands/init.js');
    await runInit();
  });

program
  .command('sync')
  .description('Sync from YNAB without entering TUI')
  .action(async () => {
    const { runSync } = await import('./commands/sync.js');
    await runSync();
  });

program
  .command('status')
  .description('Show unapproved count and inflight writes')
  .action(async () => {
    const { runStatus } = await import('./commands/status.js');
    runStatus();
  });

program.parse(process.argv);
