import type Database from 'better-sqlite3';
import type * as ynab from 'ynab';
import type { Config } from './config.js';
import { getMeta, setMeta } from './db/meta.js';
import { upsertCategories, type CategoryRow } from './db/categories.js';
import { upsertPayees, type PayeeRow } from './db/payees.js';
import { upsertTransactions, type TransactionRow } from './db/transactions.js';
import { rebuildPayeeCategoryHistory } from './db/history.js';

export interface SyncResult {
  categoriesUpdated: number;
  payeesUpdated: number;
  transactionsUpdated: number;
  serverKnowledge: number;
}

// Runs a delta sync against YNAB. On first call, fetches everything.
// On subsequent calls, passes the stored server_knowledge to get only changes.
// Updates meta.server_knowledge after a successful sync.
export async function syncFromYnab(
  db: Database.Database,
  api: ynab.API,
  config: Config
): Promise<SyncResult> {
  const storedKnowledge = getMeta(db, 'server_knowledge');
  const lastKnowledge = storedKnowledge !== undefined ? parseInt(storedKnowledge, 10) : undefined;

  const [categoriesRes, payeesRes, transactionsRes] = await Promise.all([
    api.categories.getCategories(config.budget_id, lastKnowledge),
    api.payees.getPayees(config.budget_id, lastKnowledge),
    api.transactions.getTransactions(config.budget_id, undefined, undefined, lastKnowledge),
  ]);

  // Flatten category groups into individual category rows
  const categories: CategoryRow[] = categoriesRes.data.category_groups.flatMap((group) =>
    group.categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      group_name: group.name,
      hidden: cat.hidden ? 1 : 0,
      deleted: cat.deleted ? 1 : 0,
    }))
  );

  const payees: PayeeRow[] = payeesRes.data.payees.map((p) => ({
    id: p.id,
    name: p.name,
    deleted: p.deleted ? 1 : 0,
  }));

  const transactions: TransactionRow[] = transactionsRes.data.transactions.map((t) => ({
    id: t.id,
    date: t.date,
    amount: t.amount,
    payee_id: t.payee_id ?? null,
    payee_name: t.payee_name ?? null,
    category_id: t.category_id ?? null,
    category_name: t.category_name ?? null,
    memo: t.memo ?? null,
    approved: t.approved ? 1 : 0,
    cleared: t.cleared ?? null,
    account_name: t.account_name ?? null,
    flag_color: t.flag_color ?? null,
    deleted: t.deleted ? 1 : 0,
  }));

  upsertCategories(db, categories);
  upsertPayees(db, payees);
  upsertTransactions(db, transactions);
  rebuildPayeeCategoryHistory(db);

  // Use the highest server_knowledge returned across all three endpoints
  const newKnowledge = Math.max(
    categoriesRes.data.server_knowledge,
    payeesRes.data.server_knowledge,
    transactionsRes.data.server_knowledge
  );
  setMeta(db, 'server_knowledge', String(newKnowledge));
  setMeta(db, 'last_sync_at', new Date().toISOString());

  return {
    categoriesUpdated: categories.length,
    payeesUpdated: payees.length,
    transactionsUpdated: transactions.length,
    serverKnowledge: newKnowledge,
  };
}
