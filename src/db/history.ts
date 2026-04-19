import type Database from 'better-sqlite3';

export interface HistoryRow {
  payee_id: string;
  category_id: string;
  count: number;
  last_used: string;
}

// Rebuilds payee_category_history from all approved, non-deleted transactions.
// Called after every sync. Full replace — deletes all rows first, then re-aggregates.
export function rebuildPayeeCategoryHistory(db: Database.Database): void {
  db.transaction(() => {
    db.prepare('DELETE FROM payee_category_history').run();
    db.prepare(`
      INSERT INTO payee_category_history (payee_id, category_id, count, last_used)
      SELECT
        payee_id,
        category_id,
        COUNT(*) AS count,
        MAX(date) AS last_used
      FROM transactions
      WHERE approved = 1
        AND deleted = 0
        AND payee_id IS NOT NULL
        AND category_id IS NOT NULL
      GROUP BY payee_id, category_id
    `).run();
  })();
}

// Returns history rows for a payee sorted by count descending (most-used first).
export function getPayeeHistory(db: Database.Database, payeeId: string): HistoryRow[] {
  return db
    .prepare(
      `SELECT * FROM payee_category_history
       WHERE payee_id = ?
       ORDER BY count DESC`
    )
    .all(payeeId) as HistoryRow[];
}
