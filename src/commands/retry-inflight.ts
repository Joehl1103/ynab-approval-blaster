import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { applySchema } from '../db/schema.js';
import { createYnabClient } from '../ynab.js';
import { listInflight } from '../db/inflight.js';
import { replayInflightWrites } from '../replay.js';

// `ynab-blaster retry-inflight` — force-retries any surviving inflight_writes rows.
export async function runRetryInflight(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  applySchema(db);

  const rows = listInflight(db);
  if (rows.length === 0) {
    console.log('No inflight writes to retry.');
    db.close();
    return;
  }

  console.log(`Retrying ${rows.length} inflight write(s)...`);
  const api = createYnabClient(config);
  const result = await replayInflightWrites(db, api, config.budget_id);

  console.log(`  Succeeded: ${result.succeeded}`);
  console.log(`  Failed:    ${result.failed}`);
  db.close();
}
