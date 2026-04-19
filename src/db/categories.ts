import type Database from 'better-sqlite3';

export interface CategoryRow {
  id: string;
  name: string;
  group_name: string | null;
  hidden: number;
  deleted: number;
}

// Upserts a batch of categories from a YNAB API response.
export function upsertCategories(
  db: Database.Database,
  categories: CategoryRow[]
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO categories (id, name, group_name, hidden, deleted)
    VALUES (@id, @name, @group_name, @hidden, @deleted)
  `);
  const upsertMany = db.transaction((rows: CategoryRow[]) => {
    for (const row of rows) stmt.run(row);
  });
  upsertMany(categories);
}

// Returns all non-deleted categories, optionally including hidden ones.
export function getCategories(
  db: Database.Database,
  includeHidden: boolean
): CategoryRow[] {
  const sql = includeHidden
    ? 'SELECT * FROM categories WHERE deleted = 0'
    : 'SELECT * FROM categories WHERE deleted = 0 AND hidden = 0';
  return db.prepare(sql).all() as CategoryRow[];
}
