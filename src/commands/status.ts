import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { applySchema } from '../db/schema.js';
import { getUnapprovedTransactions } from '../db/transactions.js';
import { getMeta } from '../db/meta.js';

// `ynab-blaster status` — prints counts without entering TUI.
export function runStatus(): void {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  applySchema(db);

  const unapproved = getUnapprovedTransactions(db, config.sort);
  const inflight = db
    .prepare('SELECT COUNT(*) as count FROM inflight_writes')
    .get() as { count: number };
  const lastSync = getMeta(db, 'last_sync_at') ?? 'never';

  console.log(`Unapproved transactions: ${unapproved.length}`);
  console.log(`Inflight writes:         ${inflight.count}`);
  console.log(`Last synced:             ${lastSync}`);
  db.close();
}
