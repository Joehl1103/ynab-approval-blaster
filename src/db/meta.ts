import type Database from 'better-sqlite3';

// Reads a value from the meta table by key. Returns undefined if not set.
export function getMeta(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

// Writes a value to the meta table, inserting or replacing.
export function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}
