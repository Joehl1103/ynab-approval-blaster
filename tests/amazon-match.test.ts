import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/client.js';
import { applySchema } from '../src/db/schema.js';
import { upsertAmazonCharges, upsertAmazonItems } from '../src/db/amazon.js';
import { findAmazonMatch } from '../src/amazon/match.js';
import type { TransactionRow } from '../src/db/transactions.js';
import type { AmazonConfig } from '../src/config.js';

let db: Database.Database;

const baseConfig: AmazonConfig = {
  enabled: true,
  match_window_days: 3,
  bootstrap_days: 90,
  payee_pattern: 'amazon|amzn',
  stale_warning_hours: 24,
};

function makeTx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 'tx1',
    date: '2026-04-15',
    amount: -42170,
    payee_id: 'p1',
    payee_name: 'Amazon.com',
    category_id: null,
    category_name: null,
    memo: null,
    approved: 0,
    cleared: 'cleared',
    account_name: 'Checking',
    flag_color: null,
    deleted: 0,
    ...overrides,
  };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  applySchema(db);
});

describe('findAmazonMatch', () => {
  it('matches an exact amount on the same date', () => {
    upsertAmazonCharges(db, [{
      order_number: 'ORDER-1',
      completed_date: '2026-04-15',
      total_milliunits: -42170,
      is_refund: 0,
      payment_method: 'Visa', seller: 'Amazon.com',
      raw_json: null, fetched_at: new Date().toISOString(),
    }]);
    upsertAmazonItems(db, [
      { order_number: 'ORDER-1', title: 'USB-C Cable', quantity: 1, price_milliunits: 42170 },
    ]);

    const match = findAmazonMatch(makeTx(), db, baseConfig);
    expect(match).not.toBeNull();
    expect(match!.charge.order_number).toBe('ORDER-1');
    expect(match!.items).toHaveLength(1);
    expect(match!.ambiguous).toBe(false);
  });

  it('returns null when amounts differ', () => {
    upsertAmazonCharges(db, [{
      order_number: 'ORDER-1', completed_date: '2026-04-15',
      total_milliunits: -42180, is_refund: 0,
      payment_method: null, seller: null, raw_json: null,
      fetched_at: new Date().toISOString(),
    }]);
    expect(findAmazonMatch(makeTx(), db, baseConfig)).toBeNull();
  });

  it('matches within +/- match_window_days', () => {
    upsertAmazonCharges(db, [{
      order_number: 'ORDER-1', completed_date: '2026-04-13',
      total_milliunits: -42170, is_refund: 0,
      payment_method: null, seller: null, raw_json: null,
      fetched_at: new Date().toISOString(),
    }]);
    expect(findAmazonMatch(makeTx(), db, baseConfig)).not.toBeNull();
  });

  it('returns null when charge is outside match_window_days', () => {
    upsertAmazonCharges(db, [{
      order_number: 'ORDER-1', completed_date: '2026-04-10',
      total_milliunits: -42170, is_refund: 0,
      payment_method: null, seller: null, raw_json: null,
      fetched_at: new Date().toISOString(),
    }]);
    expect(findAmazonMatch(makeTx(), db, baseConfig)).toBeNull();
  });

  it('rejects non-Amazon payees', () => {
    upsertAmazonCharges(db, [{
      order_number: 'ORDER-1', completed_date: '2026-04-15',
      total_milliunits: -42170, is_refund: 0,
      payment_method: null, seller: null, raw_json: null,
      fetched_at: new Date().toISOString(),
    }]);
    expect(findAmazonMatch(makeTx({ payee_name: 'Walmart' }), db, baseConfig)).toBeNull();
  });

  it('matches the AMZN abbreviation variant', () => {
    upsertAmazonCharges(db, [{
      order_number: 'ORDER-1', completed_date: '2026-04-15',
      total_milliunits: -42170, is_refund: 0,
      payment_method: null, seller: null, raw_json: null,
      fetched_at: new Date().toISOString(),
    }]);
    expect(findAmazonMatch(makeTx({ payee_name: 'AMZN Mktp US' }), db, baseConfig)).not.toBeNull();
  });

  it('rejects inflows (positive amounts)', () => {
    upsertAmazonCharges(db, [{
      order_number: 'ORDER-1', completed_date: '2026-04-15',
      total_milliunits: 10000, is_refund: 1,
      payment_method: null, seller: null, raw_json: null,
      fetched_at: new Date().toISOString(),
    }]);
    expect(findAmazonMatch(makeTx({ amount: 10000 }), db, baseConfig)).toBeNull();
  });

  it('returns null when feature is disabled', () => {
    upsertAmazonCharges(db, [{
      order_number: 'ORDER-1', completed_date: '2026-04-15',
      total_milliunits: -42170, is_refund: 0,
      payment_method: null, seller: null, raw_json: null,
      fetched_at: new Date().toISOString(),
    }]);
    expect(findAmazonMatch(makeTx(), db, { ...baseConfig, enabled: false })).toBeNull();
  });

  it('flags ambiguity and prefers the closest date when multiple charges match the amount', () => {
    upsertAmazonCharges(db, [
      {
        order_number: 'ORDER-FAR', completed_date: '2026-04-13',
        total_milliunits: -42170, is_refund: 0,
        payment_method: null, seller: null, raw_json: null,
        fetched_at: new Date().toISOString(),
      },
      {
        order_number: 'ORDER-CLOSE', completed_date: '2026-04-15',
        total_milliunits: -42170, is_refund: 0,
        payment_method: null, seller: null, raw_json: null,
        fetched_at: new Date().toISOString(),
      },
    ]);
    const match = findAmazonMatch(makeTx(), db, baseConfig);
    expect(match!.charge.order_number).toBe('ORDER-CLOSE');
    expect(match!.ambiguous).toBe(true);
  });

  it('attaches all items belonging to the matched charge', () => {
    upsertAmazonCharges(db, [{
      order_number: 'ORDER-1', completed_date: '2026-04-15',
      total_milliunits: -42170, is_refund: 0,
      payment_method: null, seller: null, raw_json: null,
      fetched_at: new Date().toISOString(),
    }]);
    upsertAmazonItems(db, [
      { order_number: 'ORDER-1', title: 'Widget A', quantity: 1, price_milliunits: 30000 },
      { order_number: 'ORDER-1', title: 'Widget B', quantity: 2, price_milliunits: 6000 },
    ]);
    const match = findAmazonMatch(makeTx(), db, baseConfig);
    expect(match!.items.map((i) => i.title).sort()).toEqual(['Widget A', 'Widget B']);
  });
});
