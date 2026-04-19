import type Database from 'better-sqlite3';

export interface PayeeRow {
  id: string;
  name: string;
  deleted: number;
}

// Upserts a batch of payees from a YNAB API response.
export function upsertPayees(db: Database.Database, payees: PayeeRow[]): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO payees (id, name, deleted)
    VALUES (@id, @name, @deleted)
  `);
  const upsertMany = db.transaction((rows: PayeeRow[]) => {
    for (const row of rows) stmt.run(row);
  });
  upsertMany(payees);
}
