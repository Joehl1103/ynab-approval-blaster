import type Database from 'better-sqlite3';

// Applies all table and index definitions idempotently (CREATE IF NOT EXISTS).
export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_name TEXT,
      hidden INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0,
      balance INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS payees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      deleted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      amount INTEGER NOT NULL,
      payee_id TEXT,
      payee_name TEXT,
      category_id TEXT,
      category_name TEXT,
      memo TEXT,
      approved INTEGER NOT NULL,
      cleared TEXT,
      account_name TEXT,
      flag_color TEXT,
      deleted INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_tx_approved ON transactions(approved, deleted);
    CREATE INDEX IF NOT EXISTS idx_tx_payee ON transactions(payee_id);

    CREATE TABLE IF NOT EXISTS payee_category_history (
      payee_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      count INTEGER NOT NULL,
      last_used TEXT NOT NULL,
      PRIMARY KEY (payee_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS inflight_writes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receipt_codes (
      store_name TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT,
      suggested_category_id TEXT,
      times_seen INTEGER NOT NULL DEFAULT 1,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      PRIMARY KEY (store_name, code)
    );
    CREATE INDEX IF NOT EXISTS idx_codes_store ON receipt_codes(store_name);
  `);

  // Migrate pre-existing DBs that were created before the `balance` column existed.
  const columns = db.prepare(`PRAGMA table_info(categories)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === 'balance')) {
    db.exec(`ALTER TABLE categories ADD COLUMN balance INTEGER NOT NULL DEFAULT 0`);
  }

  // One-time: after introducing `balance`, force the next sync to be a full re-fetch
  // so every row's balance populates. Delta sync would leave unchanged rows at
  // DEFAULT 0. Guarded by a meta flag so it runs exactly once per DB — covers both
  // fresh installs and users who already applied the v1 migration without this step.
  const backfillFlag = db
    .prepare(`SELECT value FROM meta WHERE key = 'balance_backfill_v1'`)
    .get() as { value: string } | undefined;
  if (!backfillFlag) {
    db.prepare(`DELETE FROM meta WHERE key = 'server_knowledge'`).run();
    db.prepare(
      `INSERT OR REPLACE INTO meta (key, value) VALUES ('balance_backfill_v1', '1')`
    ).run();
  }
}
