import type Database from 'better-sqlite3';
import type * as ynab from 'ynab';
import { listInflight, deleteInflight } from './db/inflight.js';

export interface ReplayResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

// Replays all surviving inflight_writes rows against the YNAB API.
// Called at startup when inflight rows are found. Idempotent — YNAB accepts duplicate PATCHes.
export async function replayInflightWrites(
  db: Database.Database,
  api: ynab.API,
  budgetId: string
): Promise<ReplayResult> {
  const rows = listInflight(db);
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;

    let patch: Record<string, unknown> = {};
    if (row.change_type === 'approve') {
      patch = { approved: true, category_id: payload.category_id };
    } else if (row.change_type === 'recategorize') {
      patch = { category_id: payload.category_id };
    } else if (row.change_type === 'memo') {
      patch = { memo: payload.memo };
    } else if (row.change_type === 'flag') {
      patch = { flag_color: 'purple' };
    }

    try {
      await api.transactions.updateTransaction(budgetId, row.transaction_id, {
        transaction: patch as unknown as ynab.ExistingTransaction,
      });
      deleteInflight(db, row.id);
      succeeded++;
    } catch {
      failed++;
    }
  }

  return { attempted: rows.length, succeeded, failed };
}
