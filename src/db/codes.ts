import type Database from 'better-sqlite3';

export interface ReceiptCodeRow {
  store_name: string;
  code: string;
  description: string | null;
  suggested_category_id: string | null;
  times_seen: number;
  first_seen: string;
  last_seen: string;
}

// Normalise store names so "ROSS DRESS FOR LESS" and "Ross" map to the same key.
const normaliseStore = (name: string): string => name.trim().toLowerCase();

// Normalise codes for consistent matching (trim whitespace, uppercase).
const normaliseCode = (code: string): string => code.trim().toUpperCase();

// Insert or update a receipt code. Increments times_seen on conflict.
export function upsertReceiptCode(
  db: Database.Database,
  storeName: string,
  code: string,
  description: string | null,
  suggestedCategoryId: string | null
): void {
  const now = new Date().toISOString();
  const store = normaliseStore(storeName);
  const normCode = normaliseCode(code);

  db.prepare<{
    store_name: string;
    code: string;
    description: string | null;
    suggested_category_id: string | null;
    now: string;
  }>(
    `INSERT INTO receipt_codes (store_name, code, description, suggested_category_id, times_seen, first_seen, last_seen)
     VALUES (@store_name, @code, @description, @suggested_category_id, 1, @now, @now)
     ON CONFLICT(store_name, code) DO UPDATE SET
       description = excluded.description,
       suggested_category_id = excluded.suggested_category_id,
       times_seen = times_seen + 1,
       last_seen = excluded.last_seen`
  ).run({ store_name: store, code: normCode, description, suggested_category_id: suggestedCategoryId, now });
}

// Look up an exact (store, code) pair. Returns null if not found.
export function exactLookup(
  db: Database.Database,
  storeName: string,
  code: string
): ReceiptCodeRow | null {
  const store = normaliseStore(storeName);
  const normCode = normaliseCode(code);
  const row = db
    .prepare<{ store_name: string; code: string }>(
      `SELECT * FROM receipt_codes WHERE store_name = @store_name AND code = @code`
    )
    .get({ store_name: store, code: normCode }) as ReceiptCodeRow | undefined;
  return row ?? null;
}

// Find up to `limit` codes for a store whose code contains the query as a substring.
// Returns [] when no partial matches are found.
export function partialLookup(
  db: Database.Database,
  storeName: string,
  query: string,
  limit = 5
): ReceiptCodeRow[] {
  const store = normaliseStore(storeName);
  const normQuery = normaliseCode(query);
  return db
    .prepare<{ store_name: string; query: string; limit: number }>(
      `SELECT * FROM receipt_codes
       WHERE store_name = @store_name AND code LIKE '%' || @query || '%'
       ORDER BY times_seen DESC, code ASC
       LIMIT @limit`
    )
    .all({ store_name: store, query: normQuery, limit }) as ReceiptCodeRow[];
}

// Return all receipt codes for a store, ordered by code.
export function dumpForStore(
  db: Database.Database,
  storeName: string
): ReceiptCodeRow[] {
  const store = normaliseStore(storeName);
  return db
    .prepare<{ store_name: string }>(
      `SELECT * FROM receipt_codes WHERE store_name = @store_name ORDER BY code ASC`
    )
    .all({ store_name: store }) as ReceiptCodeRow[];
}

// Return all receipt codes across all stores, grouped by store name.
export function dumpAll(db: Database.Database): ReceiptCodeRow[] {
  return db
    .prepare(`SELECT * FROM receipt_codes ORDER BY store_name ASC, code ASC`)
    .all() as ReceiptCodeRow[];
}

// Delete all receipt codes for a store (used during YAML re-import).
export function deleteForStore(db: Database.Database, storeName: string): void {
  const store = normaliseStore(storeName);
  db.prepare<{ store_name: string }>(
    `DELETE FROM receipt_codes WHERE store_name = @store_name`
  ).run({ store_name: store });
}

// Replace ALL receipt codes in one atomic transaction (used by `codes edit` YAML re-import).
export function replaceAll(db: Database.Database, rows: ReceiptCodeRow[]): void {
  const replace = db.transaction((entries: ReceiptCodeRow[]) => {
    db.prepare(`DELETE FROM receipt_codes`).run();
    const insert = db.prepare<ReceiptCodeRow>(
      `INSERT INTO receipt_codes (store_name, code, description, suggested_category_id, times_seen, first_seen, last_seen)
       VALUES (@store_name, @code, @description, @suggested_category_id, @times_seen, @first_seen, @last_seen)`
    );
    for (const row of entries) {
      insert.run({
        ...row,
        store_name: normaliseStore(row.store_name),
        code: normaliseCode(row.code),
      });
    }
  });
  replace(rows);
}
