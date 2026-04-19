import type Database from 'better-sqlite3';

export interface InflightRow {
  id: number;
  transaction_id: string;
  change_type: string;
  payload: string;
  created_at: string;
}

export interface InflightInsert {
  transaction_id: string;
  change_type: string;
  payload: string;
}

// Inserts a new inflight_writes row before firing an API call. Returns the row id.
export function insertInflight(db: Database.Database, row: InflightInsert): number {
  const result = db
    .prepare(
      `INSERT INTO inflight_writes (transaction_id, change_type, payload, created_at)
       VALUES (@transaction_id, @change_type, @payload, @created_at)`
    )
    .run({ ...row, created_at: new Date().toISOString() });
  return result.lastInsertRowid as number;
}

// Deletes an inflight row after the API call confirms success.
export function deleteInflight(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM inflight_writes WHERE id = ?').run(id);
}

// Returns all surviving inflight rows, ordered by creation time (oldest first).
export function listInflight(db: Database.Database): InflightRow[] {
  return db
    .prepare('SELECT * FROM inflight_writes ORDER BY created_at ASC')
    .all() as InflightRow[];
}
