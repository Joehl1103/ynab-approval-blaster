import { Command } from 'commander';

const program = new Command();

program
  .name('ynab-blaster')
  .description('Rip through YNAB unapproved transactions with single keystrokes')
  .version('0.1.0');

// Subcommands registered here as they are implemented
program.parse(process.argv);
