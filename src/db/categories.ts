import type Database from 'better-sqlite3';

export interface CategoryRow {
  id: string;
  name: string;
  group_name: string | null;
  hidden: number;
  deleted: number;
  balance: number;
}

export interface CategoryGroup {
  group: string;
  categories: CategoryRow[];
}

// Upserts a batch of categories from a YNAB API response.
export function upsertCategories(
  db: Database.Database,
  categories: CategoryRow[]
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO categories (id, name, group_name, hidden, deleted, balance)
    VALUES (@id, @name, @group_name, @hidden, @deleted, @balance)
  `);
  const upsertMany = db.transaction((rows: CategoryRow[]) => {
    for (const row of rows) stmt.run(row);
  });
  upsertMany(categories);
}

// Returns all non-deleted categories, optionally including hidden ones.
// Ordered by group_name, then name — stable input for the grouped picker.
export function getCategories(
  db: Database.Database,
  includeHidden: boolean
): CategoryRow[] {
  const where = includeHidden
    ? 'WHERE deleted = 0'
    : 'WHERE deleted = 0 AND hidden = 0';
  const sql = `SELECT * FROM categories ${where} ORDER BY group_name COLLATE NOCASE, name COLLATE NOCASE`;
  return db.prepare(sql).all() as CategoryRow[];
}

// Returns visible (non-hidden, non-deleted) categories grouped by group_name.
// `null` groups fall under the literal "Uncategorized" bucket. The picker view
// always hides hidden categories regardless of config.
export function getVisibleCategoriesGrouped(db: Database.Database): CategoryGroup[] {
  const rows = getCategories(db, false);
  const byGroup = new Map<string, CategoryRow[]>();
  for (const row of rows) {
    const key = row.group_name ?? 'Uncategorized';
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(row);
    else byGroup.set(key, [row]);
  }
  return Array.from(byGroup.entries()).map(([group, categories]) => ({ group, categories }));
}
