import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Header } from '../src/tui/Header.js';
import { Footer } from '../src/tui/Footer.js';
import { WriteStatus } from '../src/tui/WriteStatus.js';
import { ErrorBanner } from '../src/tui/ErrorBanner.js';
import { DefaultMode } from '../src/tui/DefaultMode.js';
import type { TransactionRow } from '../src/db/transactions.js';
import type { HistoryRow } from '../src/db/history.js';
import type { CategoryRow } from '../src/db/categories.js';

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
  { id: 'c1', name: 'Groceries', group_name: 'Food', hidden: 0, deleted: 0 },
  { id: 'c2', name: 'Household', group_name: 'Home', hidden: 0, deleted: 0 },
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
});
