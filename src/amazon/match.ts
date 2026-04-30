import type Database from 'better-sqlite3';
import type { TransactionRow } from '../db/transactions.js';
import { getAmazonItems, type AmazonChargeRow } from '../db/amazon.js';
import type { AmazonConfig } from '../config.js';
import type { AmazonMatch } from './types.js';

// Finds the best Amazon charge match for a YNAB transaction.
// Returns null when matching is disabled, the payee isn't Amazon-like,
// or no charge with the same amount lies within the configured date window.
export function findAmazonMatch(
  tx: TransactionRow,
  db: Database.Database,
  config: AmazonConfig
): AmazonMatch | null {
  if (!config.enabled) return null;

  // Skip inflows — refunds are out of scope for v1.
  if (tx.amount > 0) return null;

  // Only consider Amazon-like payees.
  if (!tx.payee_name || !new RegExp(config.payee_pattern, 'i').test(tx.payee_name)) {
    return null;
  }

  const matches = db
    .prepare(
      `SELECT * FROM amazon_charges
       WHERE total_milliunits = ?
         AND completed_date BETWEEN date(?, ?) AND date(?, ?)
       ORDER BY ABS(julianday(completed_date) - julianday(?)) ASC`
    )
    .all(
      tx.amount,
      tx.date, `-${config.match_window_days} days`,
      tx.date, `+${config.match_window_days} days`,
      tx.date
    ) as AmazonChargeRow[];

  if (matches.length === 0) return null;

  const charge = matches[0];
  const items = getAmazonItems(db, charge.order_number);

  return { charge, items, ambiguous: matches.length > 1 };
}
