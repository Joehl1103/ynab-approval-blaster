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

program
  .command('retry-inflight')
  .description('Force-retry any writes that did not confirm in a prior session')
  .action(async () => {
    const { runRetryInflight } = await import('./commands/retry-inflight.js');
    await runRetryInflight();
  });

const codesCmd = program
  .command('codes')
  .description('Manage the receipt-code dictionary');

codesCmd
  .command('list <store>')
  .description('List all dictionary entries for a store')
  .action(async (store: string) => {
    const { runCodesList } = await import('./commands/codes.js');
    runCodesList(store);
  });

codesCmd
  .command('edit')
  .description('Open the full dictionary in $EDITOR (YAML round-trip)')
  .action(async () => {
    const { runCodesEdit } = await import('./commands/codes.js');
    runCodesEdit();
  });

// Default command (no subcommand) — runs the TUI blaster.
program
  .command('run', { isDefault: true, hidden: true })
  .description('Run the approval TUI (default)')
  .action(async () => {
    const { runBlaster } = await import('./commands/run.js');
    await runBlaster();
  });

program.parse(process.argv);
