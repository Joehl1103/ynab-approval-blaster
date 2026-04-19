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
      deleted INTEGER DEFAULT 0
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
  `);
}
