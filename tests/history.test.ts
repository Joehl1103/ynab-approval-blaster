import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/db/client.js';
import { applySchema } from '../src/db/schema.js';
import { upsertTransactions } from '../src/db/transactions.js';
import { rebuildPayeeCategoryHistory, getPayeeHistory } from '../src/db/history.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  applySchema(db);
});

describe('rebuildPayeeCategoryHistory', () => {
  it('counts approved transactions per (payee, category) pair', () => {
    upsertTransactions(db, [
      {
        id: 't1', date: '2026-01-01', amount: -50000, payee_id: 'p1',
        payee_name: 'TARGET', category_id: 'c1', category_name: 'Groceries',
        memo: null, approved: 1, cleared: 'cleared', account_name: 'Checking',
        flag_color: null, deleted: 0,
      },
      {
        id: 't2', date: '2026-01-02', amount: -30000, payee_id: 'p1',
        payee_name: 'TARGET', category_id: 'c1', category_name: 'Groceries',
        memo: null, approved: 1, cleared: 'cleared', account_name: 'Checking',
        flag_color: null, deleted: 0,
      },
      {
        id: 't3', date: '2026-01-03', amount: -20000, payee_id: 'p1',
        payee_name: 'TARGET', category_id: 'c2', category_name: 'Household',
        memo: null, approved: 1, cleared: 'cleared', account_name: 'Checking',
        flag_color: null, deleted: 0,
      },
    ]);

    rebuildPayeeCategoryHistory(db);

    const history = getPayeeHistory(db, 'p1');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ category_id: 'c1', count: 2 });
    expect(history[1]).toMatchObject({ category_id: 'c2', count: 1 });
  });

  it('excludes unapproved transactions', () => {
    upsertTransactions(db, [
      {
        id: 't1', date: '2026-01-01', amount: -50000, payee_id: 'p1',
        payee_name: 'TARGET', category_id: 'c1', category_name: 'Groceries',
        memo: null, approved: 0, cleared: 'uncleared', account_name: 'Checking',
        flag_color: null, deleted: 0,
      },
    ]);
    rebuildPayeeCategoryHistory(db);
    expect(getPayeeHistory(db, 'p1')).toHaveLength(0);
  });

  it('excludes deleted transactions', () => {
    upsertTransactions(db, [
      {
        id: 't1', date: '2026-01-01', amount: -50000, payee_id: 'p1',
        payee_name: 'TARGET', category_id: 'c1', category_name: 'Groceries',
        memo: null, approved: 1, cleared: 'cleared', account_name: 'Checking',
        flag_color: null, deleted: 1,
      },
    ]);
    rebuildPayeeCategoryHistory(db);
    expect(getPayeeHistory(db, 'p1')).toHaveLength(0);
  });
});
