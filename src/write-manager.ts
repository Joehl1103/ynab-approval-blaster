import type Database from 'better-sqlite3';
import type * as ynab from 'ynab';
import { insertInflight, deleteInflight } from './db/inflight.js';

// Payload stored in inflight_writes so we can roll back on failure.
interface ApprovePayload {
  prev_approved: number;
  prev_category_id: string | null;
  category_id: string;
}

interface RecategorizePayload {
  prev_category_id: string | null;
  prev_category_name: string | null;
  category_id: string;
  category_name: string;
}

interface MemoPayload {
  prev_memo: string | null;
  memo: string;
}

interface FlagPayload {
  prev_flag_color: string | null;
}

// Manages the lifecycle of every YNAB write:
// 1. Optimistic SQLite update
// 2. Insert inflight row (for crash recovery)
// 3. Fire YNAB API call
// 4. On success: delete inflight row
// 5. On failure: rollback SQLite, leave inflight row
export class WriteManager {
  constructor(
    private db: Database.Database,
    private api: ynab.API,
    private budgetId: string
  ) {}

  // Approves a transaction with the given category. Writes to YNAB immediately.
  async approve(transactionId: string, categoryId: string): Promise<void> {
    const prev = this.db
      .prepare('SELECT approved, category_id FROM transactions WHERE id = ?')
      .get(transactionId) as { approved: number; category_id: string | null };

    const payload: ApprovePayload = {
      prev_approved: prev.approved,
      prev_category_id: prev.category_id,
      category_id: categoryId,
    };

    this.db
      .prepare('UPDATE transactions SET approved = 1, category_id = ? WHERE id = ?')
      .run(categoryId, transactionId);

    const inflightId = insertInflight(this.db, {
      transaction_id: transactionId,
      change_type: 'approve',
      payload: JSON.stringify(payload),
    });

    try {
      await this.api.transactions.updateTransaction(this.budgetId, transactionId, {
        transaction: { approved: true, category_id: categoryId },
      });
      deleteInflight(this.db, inflightId);
    } catch (err) {
      this.db
        .prepare('UPDATE transactions SET approved = ?, category_id = ? WHERE id = ?')
        .run(payload.prev_approved, payload.prev_category_id, transactionId);
      throw err;
    }
  }

  // Changes category without approving. Writes to YNAB immediately.
  async recategorize(
    transactionId: string,
    categoryId: string,
    categoryName: string
  ): Promise<void> {
    const prev = this.db
      .prepare('SELECT category_id, category_name FROM transactions WHERE id = ?')
      .get(transactionId) as { category_id: string | null; category_name: string | null };

    const payload: RecategorizePayload = {
      prev_category_id: prev.category_id,
      prev_category_name: prev.category_name,
      category_id: categoryId,
      category_name: categoryName,
    };

    this.db
      .prepare('UPDATE transactions SET category_id = ?, category_name = ? WHERE id = ?')
      .run(categoryId, categoryName, transactionId);

    const inflightId = insertInflight(this.db, {
      transaction_id: transactionId,
      change_type: 'recategorize',
      payload: JSON.stringify(payload),
    });

    try {
      await this.api.transactions.updateTransaction(this.budgetId, transactionId, {
        transaction: { category_id: categoryId },
      });
      deleteInflight(this.db, inflightId);
    } catch (err) {
      this.db
        .prepare('UPDATE transactions SET category_id = ?, category_name = ? WHERE id = ?')
        .run(payload.prev_category_id, payload.prev_category_name, transactionId);
      throw err;
    }
  }

  // Updates the memo field. Writes to YNAB immediately.
  async editMemo(transactionId: string, memo: string): Promise<void> {
    const prev = this.db
      .prepare('SELECT memo FROM transactions WHERE id = ?')
      .get(transactionId) as { memo: string | null };

    const payload: MemoPayload = { prev_memo: prev.memo, memo };

    this.db
      .prepare('UPDATE transactions SET memo = ? WHERE id = ?')
      .run(memo, transactionId);

    const inflightId = insertInflight(this.db, {
      transaction_id: transactionId,
      change_type: 'memo',
      payload: JSON.stringify(payload),
    });

    try {
      await this.api.transactions.updateTransaction(this.budgetId, transactionId, {
        transaction: { memo },
      });
      deleteInflight(this.db, inflightId);
    } catch (err) {
      this.db
        .prepare('UPDATE transactions SET memo = ? WHERE id = ?')
        .run(payload.prev_memo, transactionId);
      throw err;
    }
  }

  // Sets flag_color to purple (signals "needs split"). Writes to YNAB immediately.
  async flagForSplit(transactionId: string): Promise<void> {
    const prev = this.db
      .prepare('SELECT flag_color FROM transactions WHERE id = ?')
      .get(transactionId) as { flag_color: string | null };

    const payload: FlagPayload = { prev_flag_color: prev.flag_color };

    this.db
      .prepare("UPDATE transactions SET flag_color = 'purple' WHERE id = ?")
      .run(transactionId);

    const inflightId = insertInflight(this.db, {
      transaction_id: transactionId,
      change_type: 'flag',
      payload: JSON.stringify(payload),
    });

    try {
      await this.api.transactions.updateTransaction(this.budgetId, transactionId, {
        transaction: { flag_color: 'purple' as ynab.TransactionDetail.FlagColorEnum },
      });
      deleteInflight(this.db, inflightId);
    } catch (err) {
      this.db
        .prepare('UPDATE transactions SET flag_color = ? WHERE id = ?')
        .run(payload.prev_flag_color, transactionId);
      throw err;
    }
  }
}
