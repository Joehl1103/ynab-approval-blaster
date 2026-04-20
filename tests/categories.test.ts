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
  it('clears server_knowledge so the next sync is a full re-fetch', () => {
    // Simulate a pre-existing DB that has a stored server_knowledge but no balance column.
    // We do this by creating a DB with the OLD schema (no balance), setting knowledge, then applying the new schema.
    const oldDb = openDatabase(':memory:');
    // Create the categories table without the balance column
    oldDb.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, group_name TEXT, hidden INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0);
    `);
    setMeta(oldDb, 'server_knowledge', '42');

    // Now apply the new schema — migration should add the column and clear server_knowledge
    applySchema(oldDb);

    expect(getMeta(oldDb, 'server_knowledge')).toBeUndefined();
  });

  it('does NOT clear server_knowledge if balance column already exists', () => {
    // Fresh DB via applySchema already has balance column; server_knowledge should be untouched
    setMeta(db, 'server_knowledge', '99');
    applySchema(db); // re-run on already-migrated DB
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
});
