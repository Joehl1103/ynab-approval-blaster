import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Header } from '../src/tui/Header.js';
import { Footer } from '../src/tui/Footer.js';
import { WriteStatus } from '../src/tui/WriteStatus.js';
import { ErrorBanner } from '../src/tui/ErrorBanner.js';
import { DefaultMode } from '../src/tui/DefaultMode.js';
import { CategoryPicker } from '../src/tui/CategoryPicker.js';
import type { TransactionRow } from '../src/db/transactions.js';
import type { HistoryRow } from '../src/db/history.js';
import type { CategoryGroup, CategoryRow } from '../src/db/categories.js';

const tx: TransactionRow = {
  id: 'tx1',
  date: '2026-04-15',
  amount: -84220,
  payee_id: 'p1',
  payee_name: 'TARGET',
  category_id: 'c1',
  category_name: 'Groceries',
  memo: null,
  approved: 0,
  cleared: 'uncleared',
  account_name: 'Chase Checking',
  flag_color: null,
  deleted: 0,
};

const history: HistoryRow[] = [
  { payee_id: 'p1', category_id: 'c1', count: 26, last_used: '2026-04-01' },
  { payee_id: 'p1', category_id: 'c2', count: 11, last_used: '2026-03-01' },
];

const categories: CategoryRow[] = [
  { id: 'c1', name: 'Groceries', group_name: 'Food', hidden: 0, deleted: 0, balance: 245000 },
  { id: 'c2', name: 'Household', group_name: 'Home', hidden: 0, deleted: 0, balance: -1500 },
];

const groups: CategoryGroup[] = [
  { group: 'Food', categories: [categories[0]!] },
  { group: 'Home', categories: [categories[1]!] },
];

describe('TUI snapshots', () => {
  it('Header renders position and no syncing indicator', () => {
    const { lastFrame } = render(React.createElement(Header, { current: 3, total: 47, syncing: false }));
    expect(lastFrame()).toContain('[3/47]');
    expect(lastFrame()).not.toContain('syncing');
  });

  it('Header renders syncing indicator', () => {
    const { lastFrame } = render(React.createElement(Header, { current: 1, total: 5, syncing: true }));
    expect(lastFrame()).toContain('syncing');
  });

  it('WriteStatus renders saved state', () => {
    const { lastFrame } = render(React.createElement(WriteStatus, { status: 'saved' }));
    expect(lastFrame()).toContain('saved');
  });

  it('WriteStatus renders nothing for idle', () => {
    const { lastFrame } = render(React.createElement(WriteStatus, { status: 'idle' }));
    expect(lastFrame()).toBe('');
  });

  it('ErrorBanner renders first error', () => {
    const { lastFrame } = render(
      React.createElement(ErrorBanner, { errors: ['Something failed'], onDismiss: () => {} })
    );
    expect(lastFrame()).toContain('Something failed');
  });

  it('DefaultMode renders transaction amount and payee', () => {
    const { lastFrame } = render(
      React.createElement(DefaultMode, {
        transaction: tx,
        history,
        categories,
        suggestedCategoryName: 'Groceries',
        writeStatus: 'idle',
      })
    );
    expect(lastFrame()).toContain('TARGET');
    expect(lastFrame()).toContain('-$84.22');
    expect(lastFrame()).toContain('Suggested');
    expect(lastFrame()).toContain('Groceries');
  });

  it('DefaultMode advertises the [w] wrong-category keybind', () => {
    const { lastFrame } = render(
      React.createElement(DefaultMode, {
        transaction: tx,
        history,
        categories,
        suggestedCategoryName: 'Groceries',
        writeStatus: 'idle',
      })
    );
    expect(lastFrame()).toContain('[w] wrong category');
  });

  it('Footer legend includes the [w] wrong-category keybind', () => {
    const { lastFrame } = render(React.createElement(Footer));
    expect(lastFrame()).toContain('[w] wrong cat');
  });

  it('DefaultMode shows the current category_name on the transaction', () => {
    const { lastFrame } = render(
      React.createElement(DefaultMode, {
        transaction: tx,
        history,
        categories,
        suggestedCategoryName: 'Groceries',
        writeStatus: 'idle',
      })
    );
    expect(lastFrame()).toContain('Category: Groceries');
  });

  it('DefaultMode shows "(none)" when category_name is missing', () => {
    const txWithoutCategory: TransactionRow = { ...tx, category_id: null, category_name: null };
    const { lastFrame } = render(
      React.createElement(DefaultMode, {
        transaction: txWithoutCategory,
        history: [],
        categories,
        suggestedCategoryName: null,
        writeStatus: 'idle',
      })
    );
    expect(lastFrame()).toContain('Category: (none)');
  });

  it('DefaultMode advertises the [a] approve-as-is keybind with current category', () => {
    const { lastFrame } = render(
      React.createElement(DefaultMode, {
        transaction: tx,
        history,
        categories,
        suggestedCategoryName: 'Groceries',
        writeStatus: 'idle',
      })
    );
    expect(lastFrame()).toContain('[a] approve as-is');
    expect(lastFrame()).toContain('Groceries');
  });

  it('DefaultMode still advertises [a] approve-as-is when category_id is null (e.g. transfers / CC payments)', () => {
    const txWithoutCategory: TransactionRow = { ...tx, category_id: null, category_name: null };
    const { lastFrame } = render(
      React.createElement(DefaultMode, {
        transaction: txWithoutCategory,
        history: [],
        categories,
        suggestedCategoryName: null,
        writeStatus: 'idle',
      })
    );
    expect(lastFrame()).toContain('[a] approve as-is');
    expect(lastFrame()).toContain('YNAB-handled');
  });

  it('Footer legend includes the [a] as-is keybind', () => {
    const { lastFrame } = render(React.createElement(Footer));
    expect(lastFrame()).toContain('[a] as-is');
  });

  it('DefaultMode renders no-history message when history is empty', () => {
    const { lastFrame } = render(
      React.createElement(DefaultMode, {
        transaction: tx,
        history: [],
        categories,
        suggestedCategoryName: null,
        writeStatus: 'idle',
      })
    );
    expect(lastFrame()).toContain('no prior approvals');
  });

  it('CategoryPicker renders grouped categories with color-coded balances', () => {
    const { lastFrame } = render(
      React.createElement(CategoryPicker, {
        groups,
        onSelect: () => {},
        onCancel: () => {},
      })
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Food');
    expect(frame).toContain('Home');
    expect(frame).toContain('Groceries');
    expect(frame).toContain('Household');
    expect(frame).toContain('$245.00');
    expect(frame).toContain('$1.50');
  });

  it('CategoryPicker shows empty-state message when no groups are provided', () => {
    const { lastFrame } = render(
      React.createElement(CategoryPicker, {
        groups: [],
        onSelect: () => {},
        onCancel: () => {},
      })
    );
    expect(lastFrame()).toContain('No matching categories');
  });
});
