import React from 'react';
import { render } from 'ink';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { applySchema } from '../db/schema.js';
import { createYnabClient } from '../ynab.js';
import { listInflight } from '../db/inflight.js';
import { replayInflightWrites } from '../replay.js';
import { syncFromYnab } from '../sync.js';
import { App } from '../tui/App.js';
import { createInterface } from 'readline';

// Prompts user with a yes/no question. Returns true if they answer 'y'.
function prompt(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// Default command — full startup flow: inflight check → sync → TUI.
export async function runBlaster(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  applySchema(db);
  const api = createYnabClient(config);

  // Check for unconfirmed writes from a prior session.
  const inflight = listInflight(db);
  if (inflight.length > 0) {
    const yes = await prompt(
      `${inflight.length} write(s) from prior session did not confirm. Retry? [y/N]: `
    );
    if (yes) {
      const result = await replayInflightWrites(db, api, config.budget_id);
      console.log(`Replayed: ${result.succeeded} succeeded, ${result.failed} failed`);
    }
  }

  // Sync latest data from YNAB.
  process.stdout.write('Syncing...');
  await syncFromYnab(db, api, config);
  process.stdout.write(' done.\n');

  // Mount the Ink TUI.
  render(React.createElement(App, { db, api, config }));
}
