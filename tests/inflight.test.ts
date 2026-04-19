import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/db/client.js';
import { applySchema } from '../src/db/schema.js';
import {
  insertInflight,
  deleteInflight,
  listInflight,
} from '../src/db/inflight.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  applySchema(db);
});

describe('inflight_writes helpers', () => {
  it('inserts and lists an inflight row', () => {
    const id = insertInflight(db, {
      transaction_id: 'tx1',
      change_type: 'approve',
      payload: JSON.stringify({ category_id: 'c1' }),
    });
    const rows = listInflight(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].transaction_id).toBe('tx1');
    expect(rows[0].change_type).toBe('approve');
  });

  it('deletes an inflight row by id', () => {
    const id = insertInflight(db, {
      transaction_id: 'tx1',
      change_type: 'approve',
      payload: '{}',
    });
    deleteInflight(db, id);
    expect(listInflight(db)).toHaveLength(0);
  });

  it('returns empty list when no inflight rows exist', () => {
    expect(listInflight(db)).toHaveLength(0);
  });
});
