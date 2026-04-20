import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/client.js';
import { applySchema } from '../src/db/schema.js';
import {
  upsertReceiptCode,
  exactLookup,
  partialLookup,
  dumpForStore,
  dumpAll,
  replaceAll,
  type ReceiptCodeRow,
} from '../src/db/codes.js';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  applySchema(db);
});

describe('upsertReceiptCode', () => {
  it('inserts a new code and returns it via exactLookup', () => {
    upsertReceiptCode(db, 'Ross', 'PANTS LADIES', 'Ladies pants / bottoms', null);
    const row = exactLookup(db, 'Ross', 'PANTS LADIES');
    expect(row).not.toBeNull();
    expect(row?.description).toBe('Ladies pants / bottoms');
    expect(row?.times_seen).toBe(1);
  });

  it('normalises store name to lowercase', () => {
    upsertReceiptCode(db, 'ROSS DRESS FOR LESS', 'DEPT 42', 'Home goods', null);
    // Lookup with a different casing of the same store should still find it.
    const row = exactLookup(db, 'ross dress for less', 'DEPT 42');
    expect(row).not.toBeNull();
  });

  it('normalises code to uppercase', () => {
    upsertReceiptCode(db, 'Target', 'dept 42', 'Home goods', null);
    const row = exactLookup(db, 'Target', 'DEPT 42');
    expect(row).not.toBeNull();
  });

  it('increments times_seen and updates description on conflict', () => {
    upsertReceiptCode(db, 'TJ Maxx', '284070725', 'Old description', null);
    upsertReceiptCode(db, 'TJ Maxx', '284070725', 'Updated description', 'cat-1');
    const row = exactLookup(db, 'TJ Maxx', '284070725');
    expect(row?.times_seen).toBe(2);
    expect(row?.description).toBe('Updated description');
    expect(row?.suggested_category_id).toBe('cat-1');
  });

  it('stores suggested_category_id', () => {
    upsertReceiptCode(db, 'Burlington', 'DEPT 10', 'Clothing', 'cat-abc');
    const row = exactLookup(db, 'Burlington', 'DEPT 10');
    expect(row?.suggested_category_id).toBe('cat-abc');
  });
});

describe('exactLookup', () => {
  it('returns null when code does not exist', () => {
    const row = exactLookup(db, 'Target', 'NONEXISTENT');
    expect(row).toBeNull();
  });

  it('is case-insensitive for both store and code', () => {
    upsertReceiptCode(db, 'target', 'food & bev', 'Food and beverages', null);
    const row = exactLookup(db, 'TARGET', 'FOOD & BEV');
    expect(row).not.toBeNull();
  });
});

describe('partialLookup', () => {
  beforeEach(() => {
    upsertReceiptCode(db, 'Ross', 'DEPT 1', 'Department 1', null);
    upsertReceiptCode(db, 'Ross', 'DEPT 2', 'Department 2', null);
    upsertReceiptCode(db, 'Ross', 'DEPT 10', 'Department 10', null);
    upsertReceiptCode(db, 'Ross', 'PANTS LADIES', 'Ladies pants', null);
    upsertReceiptCode(db, 'TJ Maxx', 'DEPT 3', 'Different store dept', null);
  });

  it('returns codes matching the query fragment for the given store', () => {
    const results = partialLookup(db, 'Ross', 'DEPT');
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.store_name === 'ross')).toBe(true);
  });

  it('does not return codes from other stores', () => {
    const results = partialLookup(db, 'Ross', 'DEPT');
    expect(results.some((r) => r.store_name === 'tj maxx')).toBe(false);
  });

  it('returns empty array when no partial match found', () => {
    const results = partialLookup(db, 'Ross', 'ZZZZZ');
    expect(results).toHaveLength(0);
  });

  it('respects the limit parameter', () => {
    const results = partialLookup(db, 'Ross', 'DEPT', 2);
    expect(results).toHaveLength(2);
  });
});

describe('dumpForStore', () => {
  it('returns all codes for a store ordered by code', () => {
    upsertReceiptCode(db, 'Target', 'ZEBRA', 'Z item', null);
    upsertReceiptCode(db, 'Target', 'APPLE', 'A item', null);
    upsertReceiptCode(db, 'Ross', 'OTHER', 'Other store', null);

    const results = dumpForStore(db, 'Target');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.code)).toEqual(['APPLE', 'ZEBRA']);
  });

  it('returns empty array for unknown store', () => {
    expect(dumpForStore(db, 'Unknown Store')).toHaveLength(0);
  });
});

describe('dumpAll', () => {
  it('returns codes from all stores ordered by store then code', () => {
    upsertReceiptCode(db, 'Ross', 'CODE-B', 'B', null);
    upsertReceiptCode(db, 'Target', 'CODE-A', 'A', null);
    upsertReceiptCode(db, 'Ross', 'CODE-A', 'A', null);

    const results = dumpAll(db);
    expect(results[0].store_name).toBe('ross');
    expect(results[0].code).toBe('CODE-A');
    expect(results[1].store_name).toBe('ross');
    expect(results[1].code).toBe('CODE-B');
    expect(results[2].store_name).toBe('target');
  });
});

describe('replaceAll', () => {
  it('replaces all existing codes with the new set atomically', () => {
    upsertReceiptCode(db, 'Old Store', 'OLD-1', 'Old', null);

    const newRows: ReceiptCodeRow[] = [
      {
        store_name: 'new store',
        code: 'NEW-1',
        description: 'New item',
        suggested_category_id: null,
        times_seen: 3,
        first_seen: '2025-01-01T00:00:00.000Z',
        last_seen: '2025-01-02T00:00:00.000Z',
      },
    ];

    replaceAll(db, newRows);

    // Old data gone.
    expect(exactLookup(db, 'Old Store', 'OLD-1')).toBeNull();
    // New data present.
    const row = exactLookup(db, 'new store', 'NEW-1');
    expect(row?.description).toBe('New item');
    expect(row?.times_seen).toBe(3);
  });

  it('normalises store and code during replaceAll', () => {
    const newRows: ReceiptCodeRow[] = [
      {
        store_name: 'UPPERCASE STORE',
        code: 'lowercase-code',
        description: 'Test',
        suggested_category_id: null,
        times_seen: 1,
        first_seen: '2025-01-01T00:00:00.000Z',
        last_seen: '2025-01-01T00:00:00.000Z',
      },
    ];
    replaceAll(db, newRows);
    // Should be findable via normalised form.
    expect(exactLookup(db, 'uppercase store', 'LOWERCASE-CODE')).not.toBeNull();
  });
});
