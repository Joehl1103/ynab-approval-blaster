import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { applySchema } from '../db/schema.js';
import { loadAmazonEnv, hasAmazonAuthAvailable } from '../amazon/client.js';
import { runAmazonSync } from '../amazon/sync.js';

// `ynab-blaster amazon-sync [--days N]` — fatal on error; useful for first-run
// bootstrap and explicit re-pulls.
export async function runAmazonSyncCommand(opts: { days?: number }): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  applySchema(db);

  loadAmazonEnv();
  if (!hasAmazonAuthAvailable()) {
    console.error(
      'Amazon auth not found. Either set AMAZON_USERNAME (or AMAZON_EMAIL) and ' +
        'AMAZON_PASSWORD in your environment / ~/.config/ynab-blaster/amazon.env, ' +
        'or run `ynab-blaster amazon-login` to create a persisted browser session.'
    );
    process.exit(1);
  }

  const result = await runAmazonSync(db, config.amazon, { overrideDays: opts.days });

  console.log('Sync complete.');
  console.log(`  Charges: ${result.chargesAdded}`);
  console.log(`  Items:   ${result.itemsAdded}`);
  console.log(`  Window:  last ${result.daysWindow} days`);

  db.close();
}
