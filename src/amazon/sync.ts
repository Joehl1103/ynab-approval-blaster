import { spawn } from 'child_process';
import type Database from 'better-sqlite3';
import { setMeta } from '../db/meta.js';
import {
  upsertAmazonCharges,
  upsertAmazonItems,
  getLatestAmazonChargeDate,
  type AmazonChargeRow,
  type AmazonItemRow,
} from '../db/amazon.js';
import {
  loadAmazonEnv,
  hasAmazonAuthAvailable,
  resolvePython,
  getExportScriptPath,
} from './client.js';
import type { AmazonConfig } from '../config.js';
import type { AmazonSyncResult, ExportPayload } from './types.js';

// Runs scripts/amazon_export.py as a subprocess and returns its parsed JSON output.
// Inherits stderr so progress messages appear in the parent terminal.
async function runExport(days: number): Promise<ExportPayload> {
  const python = resolvePython();
  const script = getExportScriptPath();

  return await new Promise<ExportPayload>((resolve, reject) => {
    const child = spawn(python, [script, '--days', String(days)], {
      // Forward env so the script can read AMAZON_USERNAME / AMAZON_PASSWORD.
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = stderr.trim();
        reject(
          new Error(
            detail
              ? `amazon_export.py exited with code ${code}: ${detail}`
              : `amazon_export.py exited with code ${code}`
          )
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ExportPayload);
      } catch (e) {
        reject(new Error(`failed to parse amazon_export.py output as JSON: ${(e as Error).message}`));
      }
    });
  });
}

// Decides how many days back to sync.
// Override wins; otherwise: incremental from latest charge date (with 2d buffer)
// OR bootstrap_days when the table is empty.
function resolveDaysWindow(
  db: Database.Database,
  config: AmazonConfig,
  overrideDays?: number
): number {
  if (overrideDays !== undefined) return overrideDays;

  const latest = getLatestAmazonChargeDate(db);
  if (!latest) return config.bootstrap_days;

  const latestMs = new Date(latest + 'T00:00:00').getTime();
  const todayMs = Date.now();
  const daysSinceLatest = Math.ceil((todayMs - latestMs) / (24 * 60 * 60 * 1000));
  // 2-day buffer covers late-finalized transactions / clock skew.
  return Math.max(daysSinceLatest + 2, 1);
}

// Pulls Amazon transactions + orders via the Python helper and persists them.
export async function runAmazonSync(
  db: Database.Database,
  config: AmazonConfig,
  opts: { overrideDays?: number } = {}
): Promise<AmazonSyncResult> {
  const days = resolveDaysWindow(db, config, opts.overrideDays);
  const now = new Date().toISOString();

  setMeta(db, 'amazon_last_attempt', now);

  const payload = await runExport(days);

  const charges: AmazonChargeRow[] = payload.transactions
    .filter((t) => t.completed_date != null)
    .map((t) => ({
      order_number: t.order_number,
      completed_date: t.completed_date as string,
      total_milliunits: t.milliunits,
      is_refund: t.is_refund ? 1 : 0,
      payment_method: t.payment_method ?? null,
      seller: t.seller ?? null,
      raw_json: JSON.stringify(t),
      fetched_at: now,
    }));

  const items: Omit<AmazonItemRow, 'id'>[] = [];
  for (const order of payload.orders) {
    for (const item of order.items) {
      items.push({
        order_number: order.order_number,
        title: item.title,
        quantity: item.quantity,
        price_milliunits: item.price != null ? Math.round(item.price * 1000) : null,
      });
    }
  }

  upsertAmazonCharges(db, charges);
  upsertAmazonItems(db, items);

  setMeta(db, 'amazon_last_success', now);
  setMeta(db, 'amazon_last_error', '');

  return { chargesAdded: charges.length, itemsAdded: items.length, daysWindow: days };
}

// Non-fatal variant for the auto-sync path. Logs warnings, never throws.
export async function runAmazonSyncSafe(
  db: Database.Database,
  config: AmazonConfig
): Promise<AmazonSyncResult | null> {
  loadAmazonEnv();
  if (!config.enabled || !hasAmazonAuthAvailable()) return null;

  try {
    return await runAmazonSync(db, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const now = new Date().toISOString();
    try {
      setMeta(db, 'amazon_last_error', message);
      setMeta(db, 'amazon_last_attempt', now);
    } catch {
      /* DB may be broken too; stay non-fatal. */
    }
    process.stderr.write(
      `[amazon-sync] failed: ${message}. Continuing with existing data.\n`
    );
    return null;
  }
}
