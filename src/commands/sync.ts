import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { applySchema } from '../db/schema.js';
import { createYnabClient } from '../ynab.js';
import { syncFromYnab } from '../sync.js';

// `ynab-blaster sync` — syncs from YNAB and prints a summary. No TUI.
export async function runSync(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  applySchema(db);
  const api = createYnabClient(config);

  console.log('Syncing from YNAB...');
  const result = await syncFromYnab(db, api, config);
  console.log('Sync complete.');
  console.log(`  Categories:       ${result.categoriesUpdated}`);
  console.log(`  Payees:           ${result.payeesUpdated}`);
  console.log(`  Transactions:     ${result.transactionsUpdated}`);
  console.log(`  Server knowledge: ${result.serverKnowledge}`);
  db.close();
}
