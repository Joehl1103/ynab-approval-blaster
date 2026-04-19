import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/db/client.js';
import { applySchema } from '../src/db/schema.js';
import {
  getCategories,
  getVisibleCategoriesGrouped,
  upsertCategories,
  type CategoryRow,
} from '../src/db/categories.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

const rows: CategoryRow[] = [
  { id: 'c1', name: 'Groceries', group_name: 'Food', hidden: 0, deleted: 0, balance: 120000 },
  { id: 'c2', name: 'Dining Out', group_name: 'Food', hidden: 0, deleted: 0, balance: 0 },
  { id: 'c3', name: 'Rent', group_name: 'Home', hidden: 0, deleted: 0, balance: -50000 },
  { id: 'c4', name: 'Secret Stash', group_name: 'Hidden', hidden: 1, deleted: 0, balance: 9999 },
  { id: 'c5', name: 'Old Thing', group_name: 'Food', hidden: 0, deleted: 1, balance: 0 },
  { id: 'c6', name: 'Orphan', group_name: null, hidden: 0, deleted: 0, balance: 42 },
];

beforeEach(() => {
  db = openDatabase(':memory:');
  applySchema(db);
  upsertCategories(db, rows);
});

describe('getCategories', () => {
  it('excludes hidden and deleted categories by default', () => {
    const result = getCategories(db, false);
    const ids = result.map((r) => r.id);
    expect(ids).not.toContain('c4');
    expect(ids).not.toContain('c5');
    expect(ids).toContain('c1');
    expect(ids).toContain('c3');
  });

  it('includes hidden but still excludes deleted when includeHidden=true', () => {
    const result = getCategories(db, true);
    const ids = result.map((r) => r.id);
    expect(ids).toContain('c4');
    expect(ids).not.toContain('c5');
  });

  it('persists and returns the balance field', () => {
    const result = getCategories(db, false);
    const groceries = result.find((r) => r.id === 'c1');
    expect(groceries?.balance).toBe(120000);
  });
});

describe('getVisibleCategoriesGrouped', () => {
  it('always hides hidden categories regardless of config', () => {
    const groups = getVisibleCategoriesGrouped(db);
    const allIds = groups.flatMap((g) => g.categories.map((c) => c.id));
    expect(allIds).not.toContain('c4');
  });

  it('buckets null group_name under "Uncategorized"', () => {
    const groups = getVisibleCategoriesGrouped(db);
    const uncategorized = groups.find((g) => g.group === 'Uncategorized');
    expect(uncategorized?.categories.map((c) => c.id)).toEqual(['c6']);
  });

  it('groups categories by group_name and preserves sort within group', () => {
    const groups = getVisibleCategoriesGrouped(db);
    const food = groups.find((g) => g.group === 'Food');
    expect(food?.categories.map((c) => c.name)).toEqual(['Dining Out', 'Groceries']);
  });
});
