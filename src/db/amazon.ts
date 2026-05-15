import type Database from 'better-sqlite3';

export interface AmazonChargeRow {
  order_number: string;
  completed_date: string;
  total_milliunits: number;
  is_refund: number;
  payment_method: string | null;
  seller: string | null;
  raw_json: string | null;
  fetched_at: string;
}

export interface AmazonItemRow {
  id: number;
  order_number: string;
  title: string;
  quantity: number;
  price_milliunits: number | null;
}

// Upserts a batch of charges. Compound primary key ensures idempotent re-syncs.
export function upsertAmazonCharges(
  db: Database.Database,
  charges: AmazonChargeRow[]
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO amazon_charges
      (order_number, completed_date, total_milliunits, is_refund,
       payment_method, seller, raw_json, fetched_at)
    VALUES
      (@order_number, @completed_date, @total_milliunits, @is_refund,
       @payment_method, @seller, @raw_json, @fetched_at)
  `);
  const upsertMany = db.transaction((rows: AmazonChargeRow[]) => {
    for (const row of rows) stmt.run(row);
  });
  upsertMany(charges);
}

// Upserts a batch of items keyed by (order_number, title).
export function upsertAmazonItems(
  db: Database.Database,
  items: Omit<AmazonItemRow, 'id'>[]
): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO amazon_items
      (order_number, title, quantity, price_milliunits)
    VALUES
      (@order_number, @title, @quantity, @price_milliunits)
  `);
  const upsertMany = db.transaction((rows: Omit<AmazonItemRow, 'id'>[]) => {
    for (const row of rows) stmt.run(row);
  });
  upsertMany(items);
}

// Returns the most recent completed_date stored, or null if empty.
export function getLatestAmazonChargeDate(db: Database.Database): string | null {
  const row = db
    .prepare('SELECT MAX(completed_date) as d FROM amazon_charges')
    .get() as { d: string | null };
  return row.d;
}

// Returns all items belonging to an Amazon order.
export function getAmazonItems(
  db: Database.Database,
  orderNumber: string
): AmazonItemRow[] {
  return db
    .prepare('SELECT * FROM amazon_items WHERE order_number = ?')
    .all(orderNumber) as AmazonItemRow[];
}
