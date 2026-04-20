import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/db/client.js';
import { applySchema } from '../src/db/schema.js';
import { getMeta, setMeta } from '../src/db/meta.js';
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

describe('balance column migration', () => {
  it('clears server_knowledge on the first applySchema and records a backfill flag', () => {
    // Simulate a pre-existing DB with the OLD categories schema (no balance column) and a
    // stored server_knowledge from a previous delta sync.
    const oldDb = openDatabase(':memory:');
    oldDb.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, group_name TEXT, hidden INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0);
    `);
    setMeta(oldDb, 'server_knowledge', '42');

    applySchema(oldDb);

    expect(getMeta(oldDb, 'server_knowledge')).toBeUndefined();
    expect(getMeta(oldDb, 'balance_backfill_v1')).toBe('1');
  });

  it('clears server_knowledge even when the balance column already exists (v1 migration already ran)', () => {
    // Simulate a user who ran the buggy v1 migration: balance column present, but
    // server_knowledge was never cleared and no backfill flag was set.
    const oldDb = openDatabase(':memory:');
    oldDb.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, group_name TEXT, hidden INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, balance INTEGER NOT NULL DEFAULT 0);
    `);
    setMeta(oldDb, 'server_knowledge', '42');

    applySchema(oldDb);

    expect(getMeta(oldDb, 'server_knowledge')).toBeUndefined();
    expect(getMeta(oldDb, 'balance_backfill_v1')).toBe('1');
  });

  it('does NOT clear server_knowledge on subsequent applySchema calls', () => {
    // db was already migrated in beforeEach, so the flag is set.
    setMeta(db, 'server_knowledge', '99');
    applySchema(db);
    expect(getMeta(db, 'server_knowledge')).toBe('99');
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

  it('pins "Internal Master Category" to the top of the group list', () => {
    upsertCategories(db, [
      {
        id: 'i1',
        name: 'Inflow: Ready to Assign',
        group_name: 'Internal Master Category',
        hidden: 0,
        deleted: 0,
        balance: 28221030,
      },
    ]);
    const groups = getVisibleCategoriesGrouped(db);
    expect(groups[0]?.group).toBe('Internal Master Category');
    expect(groups[0]?.categories.map((c) => c.name)).toContain('Inflow: Ready to Assign');
  });
});
