import { describe, it, expect } from 'vitest';
import { suggestFromReceipt } from '../src/receipt/suggest.js';
import type { CategoryRow } from '../src/db/categories.js';
import type { HistoryRow } from '../src/db/history.js';
import type { TransactionRow } from '../src/db/transactions.js';
import type { ParsedReceipt } from '../src/receipt/types.js';

const groceries: CategoryRow = {
  id: 'cat-grocery',
  name: 'Groceries',
  group_name: 'Food',
  hidden: 0,
  deleted: 0,
  balance: 100000,
};

const household: CategoryRow = {
  id: 'cat-household',
  name: 'Household',
  group_name: 'Home',
  hidden: 0,
  deleted: 0,
  balance: 50000,
};

const gas: CategoryRow = {
  id: 'cat-gas',
  name: 'Gas',
  group_name: 'Transportation',
  hidden: 0,
  deleted: 0,
  balance: 30000,
};

const targetTx: TransactionRow = {
  id: 'tx-1',
  date: '2026-04-15',
  amount: -37930, // -$37.93
  payee_id: 'p-target',
  payee_name: 'TARGET',
  category_id: null,
  category_name: null,
  memo: null,
  approved: 0,
  cleared: 'cleared',
  account_name: 'Chase',
  flag_color: null,
  deleted: 0,
};

const baseParsed: ParsedReceipt = {
  merchant: 'TARGET',
  date: '2026-04-15',
  total_milliunits: -37930,
  items: [
    { description: 'MILK 2%', amount_milliunits: -3990 },
    { description: 'BREAD', amount_milliunits: -4490 },
  ],
  raw_lines: ['TARGET', 'MILK 2% 3.99', 'BREAD 4.49'],
};

describe('suggestFromReceipt', () => {
  it('uses payee history as the dominant signal when it is strong', () => {
    const history: HistoryRow[] = [
      { payee_id: 'p-target', category_id: 'cat-grocery', count: 26, last_used: '2026-04-01' },
      { payee_id: 'p-target', category_id: 'cat-household', count: 4, last_used: '2026-03-01' },
    ];
    const out = suggestFromReceipt({
      parsed: baseParsed,
      transaction: targetTx,
      categories: [groceries, household, gas],
      history,
      keywordMap: [{ keywords: ['detergent'], category: 'Household' }],
    });
    expect(out.category_id).toBe('cat-grocery');
    expect(out.reason.kind).toBe('payee_history');
    if (out.reason.kind === 'payee_history') {
      expect(out.reason.pct).toBe(87);
    }
    expect(out.merchant_match).toBe('matches');
    expect(out.date_match).toBe('matches');
    expect(out.total_mismatch).toBe(false);
  });

  it('falls back to keyword map when payee history is empty', () => {
    const out = suggestFromReceipt({
      parsed: { ...baseParsed, items: [{ description: 'UNLEADED 87', amount_milliunits: -42000 }] },
      transaction: { ...targetTx, payee_name: 'SHELL', amount: -42000, total_milliunits: -42000 } as TransactionRow,
      categories: [groceries, household, gas],
      history: [],
      keywordMap: [{ keywords: ['unleaded', 'fuel'], category: 'Gas' }],
    });
    expect(out.category_id).toBe('cat-gas');
    expect(out.reason.kind).toBe('keyword');
    if (out.reason.kind === 'keyword') {
      expect(out.reason.keyword).toBe('unleaded');
    }
  });

  it('falls back to weak payee history when keyword map misses', () => {
    const history: HistoryRow[] = [
      { payee_id: 'p-target', category_id: 'cat-grocery', count: 5, last_used: '2026-01-01' },
      { payee_id: 'p-target', category_id: 'cat-household', count: 5, last_used: '2026-02-01' },
      { payee_id: 'p-target', category_id: 'cat-gas', count: 4, last_used: '2026-03-01' },
    ];
    const out = suggestFromReceipt({
      parsed: baseParsed,
      transaction: targetTx,
      categories: [groceries, household, gas],
      history,
      keywordMap: [],
    });
    expect(out.category_id).toBe('cat-grocery');
    expect(out.reason.kind).toBe('payee_history');
    if (out.reason.kind === 'payee_history') {
      expect(out.reason.pct).toBeLessThan(50);
    }
  });

  it('returns null suggestion when nothing matches', () => {
    const out = suggestFromReceipt({
      parsed: { ...baseParsed, merchant: 'UNKNOWN', items: [] },
      transaction: targetTx,
      categories: [groceries, household, gas],
      history: [],
      keywordMap: [],
    });
    expect(out.category_id).toBeNull();
    expect(out.reason.kind).toBe('none');
  });

  it('flags total mismatch when receipt total disagrees with tx amount', () => {
    const out = suggestFromReceipt({
      parsed: { ...baseParsed, total_milliunits: -50000 },
      transaction: targetTx,
      categories: [groceries],
      history: [
        { payee_id: 'p-target', category_id: 'cat-grocery', count: 26, last_used: '2026-04-01' },
      ],
      keywordMap: [],
    });
    expect(out.total_mismatch).toBe(true);
    expect(out.total_diff_milliunits).toBe(-50000 - -37930);
  });

  it('matches merchants loosely when store numbers are present', () => {
    const out = suggestFromReceipt({
      parsed: { ...baseParsed, merchant: 'TARGET #1847' },
      transaction: targetTx,
      categories: [groceries],
      history: [
        { payee_id: 'p-target', category_id: 'cat-grocery', count: 10, last_used: '2026-04-01' },
      ],
      keywordMap: [],
    });
    expect(out.merchant_match).toBe('matches');
  });

  it('treats dates within 3 days as matching (weekend posting drift)', () => {
    const out = suggestFromReceipt({
      parsed: { ...baseParsed, date: '2026-04-13' },
      transaction: targetTx, // tx date 2026-04-15
      categories: [groceries],
      history: [
        { payee_id: 'p-target', category_id: 'cat-grocery', count: 10, last_used: '2026-04-01' },
      ],
      keywordMap: [],
    });
    expect(out.date_match).toBe('matches');
  });

  it('flags differing dates beyond the tolerance window', () => {
    const out = suggestFromReceipt({
      parsed: { ...baseParsed, date: '2026-01-01' },
      transaction: targetTx, // tx date 2026-04-15
      categories: [groceries],
      history: [],
      keywordMap: [],
    });
    expect(out.date_match).toBe('differs');
  });
});
