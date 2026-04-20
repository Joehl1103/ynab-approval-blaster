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

// Group names that YNAB treats as system/internal and that we pin to the top
// of the picker so they appear in the same position as in the YNAB web UI.
// Preserving array order defines the pin order.
const PINNED_GROUPS: string[] = ['Internal Master Category'];

// Returns non-deleted categories grouped by group_name, honoring the caller's
// includeHidden choice (driven by config.include_hidden_categories). `null`
// groups fall under the literal "Uncategorized" bucket. Pinned groups (see
// PINNED_GROUPS) are moved to the top, preserving their relative pin order;
// remaining groups keep the alphabetical order from getCategories().
export function getCategoriesGrouped(
  db: Database.Database,
  includeHidden: boolean
): CategoryGroup[] {
  const rows = getCategories(db, includeHidden);
  const byGroup = new Map<string, CategoryRow[]>();
  for (const row of rows) {
    const key = row.group_name ?? 'Uncategorized';
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(row);
    else byGroup.set(key, [row]);
  }
  const pinned: CategoryGroup[] = [];
  const rest: CategoryGroup[] = [];
  for (const [group, categories] of byGroup.entries()) {
    const entry = { group, categories };
    if (PINNED_GROUPS.includes(group)) pinned.push(entry);
    else rest.push(entry);
  }
  pinned.sort(
    (a, b) => PINNED_GROUPS.indexOf(a.group) - PINNED_GROUPS.indexOf(b.group)
  );
  return [...pinned, ...rest];
}
