import type Database from 'better-sqlite3';

export interface TransactionRow {
  id: string;
  date: string;
  amount: number;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  memo: string | null;
  approved: number;
  cleared: string | null;
  account_name: string | null;
  flag_color: string | null;
  deleted: number;
}

// Upserts a batch of transactions from a YNAB API response.
export function upsertTransactions(
  db: Database.Database,
  transactions: TransactionRow[]
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO transactions
      (id, date, amount, payee_id, payee_name, category_id, category_name,
       memo, approved, cleared, account_name, flag_color, deleted)
    VALUES
      (@id, @date, @amount, @payee_id, @payee_name, @category_id, @category_name,
       @memo, @approved, @cleared, @account_name, @flag_color, @deleted)
  `);
  const upsertMany = db.transaction((rows: TransactionRow[]) => {
    for (const row of rows) stmt.run(row);
  });
  upsertMany(transactions);
}

// Returns all unapproved, non-deleted transactions in the requested order.
// sort values are controlled by TypeScript types — never interpolate user input here.
export function getUnapprovedTransactions(
  db: Database.Database,
  sort: 'date_desc' | 'date_asc' | 'account'
): TransactionRow[] {
  const orderBy =
    sort === 'date_asc'
      ? 'date ASC'
      : sort === 'account'
      ? 'account_name ASC, date DESC'
      : 'date DESC';
  return db
    .prepare(
      `SELECT * FROM transactions WHERE approved = 0 AND deleted = 0 ORDER BY ${orderBy}`
    )
    .all() as TransactionRow[];
}
