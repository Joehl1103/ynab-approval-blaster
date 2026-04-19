import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDatabase } from '../src/db/client.js';
import { applySchema } from '../src/db/schema.js';
import { upsertTransactions } from '../src/db/transactions.js';
import { listInflight } from '../src/db/inflight.js';
import { WriteManager } from '../src/write-manager.js';
import type Database from 'better-sqlite3';
import type * as ynab from 'ynab';

let db: Database.Database;

const baseTx = {
  id: 'tx1',
  date: '2026-01-01',
  amount: -50000,
  payee_id: 'p1',
  payee_name: 'TARGET',
  category_id: 'c1',
  category_name: 'Groceries',
  memo: null,
  approved: 0,
  cleared: 'uncleared',
  account_name: 'Checking',
  flag_color: null,
  deleted: 0,
};

beforeEach(() => {
  db = openDatabase(':memory:');
  applySchema(db);
  upsertTransactions(db, [baseTx]);
});

describe('WriteManager.approve', () => {
  it('optimistically marks transaction approved in SQLite', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await manager.approve('tx1', 'c1');

    const row = db
      .prepare('SELECT approved FROM transactions WHERE id = ?')
      .get('tx1') as { approved: number };
    expect(row.approved).toBe(1);
  });

  it('clears inflight row after successful API call', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await manager.approve('tx1', 'c1');

    expect(listInflight(db)).toHaveLength(0);
  });

  it('rolls back optimistic update on API failure', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await expect(manager.approve('tx1', 'c1')).rejects.toThrow('Network error');

    const row = db
      .prepare('SELECT approved FROM transactions WHERE id = ?')
      .get('tx1') as { approved: number };
    expect(row.approved).toBe(0);
  });

  it('leaves inflight row in place on API failure', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await expect(manager.approve('tx1', 'c1')).rejects.toThrow();

    expect(listInflight(db)).toHaveLength(1);
  });
});

describe('WriteManager.recategorize', () => {
  it('updates category_id and category_name optimistically', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await manager.recategorize('tx1', 'c2', 'Household');

    const row = db
      .prepare('SELECT category_id, category_name FROM transactions WHERE id = ?')
      .get('tx1') as { category_id: string; category_name: string };
    expect(row.category_id).toBe('c2');
    expect(row.category_name).toBe('Household');
  });
});

describe('WriteManager.editMemo', () => {
  it('updates memo optimistically', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await manager.editMemo('tx1', 'birthday gift');

    const row = db
      .prepare('SELECT memo FROM transactions WHERE id = ?')
      .get('tx1') as { memo: string };
    expect(row.memo).toBe('birthday gift');
  });
});

describe('WriteManager.flagForSplit', () => {
  it('sets flag_color to purple', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await manager.flagForSplit('tx1');

    const row = db
      .prepare('SELECT flag_color FROM transactions WHERE id = ?')
      .get('tx1') as { flag_color: string };
    expect(row.flag_color).toBe('purple');
  });
});
