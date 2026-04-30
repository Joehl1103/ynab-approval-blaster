import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/db/client.js';
import { applySchema } from '../src/db/schema.js';
import type { AmazonConfig } from '../src/config.js';

let db: Database.Database;

const config: AmazonConfig = {
  enabled: true,
  match_window_days: 3,
  bootstrap_days: 90,
  payee_pattern: 'amazon|amzn',
  stale_warning_hours: 24,
};

beforeEach(() => {
  db = openDatabase(':memory:');
  applySchema(db);
  vi.resetModules();
  // Provide creds so hasAmazonCreds() returns true.
  process.env.AMAZON_USERNAME = 'test@example.com';
  process.env.AMAZON_PASSWORD = 'pw';
});

// Builds a fake ChildProcess that writes the given stdout payload then exits 0.
function fakeChild(stdout: string, exitCode = 0): EventEmitter {
  const child = new EventEmitter() as EventEmitter & { stdout: Readable };
  child.stdout = Readable.from([Buffer.from(stdout, 'utf8')]);
  setImmediate(() => child.emit('close', exitCode));
  return child;
}

describe('runAmazonSync', () => {
  it('persists transactions + items returned by the Python helper', async () => {
    const payload = {
      transactions: [
        {
          order_number: 'ORDER-1', completed_date: '2026-04-15',
          grand_total: -42.17, is_refund: false, milliunits: -42170,
          payment_method: 'Visa', seller: 'Amazon.com',
        },
      ],
      orders: [
        {
          order_number: 'ORDER-1', order_placed_date: '2026-04-15',
          grand_total: 42.17,
          items: [
            { title: 'USB-C Cable', price: 12.99, quantity: 1 },
            { title: 'Phone Stand', price: 14.59, quantity: 2 },
          ],
        },
      ],
    };

    vi.doMock('child_process', () => ({
      spawn: () => fakeChild(JSON.stringify(payload)),
    }));
    // Force resolvePython to return a synthetic path so we don't hit the FS.
    vi.doMock('../src/amazon/client.js', async (importOriginal) => {
      const mod = await importOriginal<typeof import('../src/amazon/client.js')>();
      return { ...mod, resolvePython: () => '/usr/bin/python3' };
    });

    const { runAmazonSync } = await import('../src/amazon/sync.js');
    const result = await runAmazonSync(db, config, { overrideDays: 30 });

    expect(result.chargesAdded).toBe(1);
    expect(result.itemsAdded).toBe(2);
    expect(result.daysWindow).toBe(30);

    const charges = db.prepare('SELECT * FROM amazon_charges').all() as Array<{
      order_number: string;
      total_milliunits: number;
    }>;
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ order_number: 'ORDER-1', total_milliunits: -42170 });

    const items = db.prepare('SELECT * FROM amazon_items').all() as Array<{ title: string }>;
    expect(items.map((i) => i.title).sort()).toEqual(['Phone Stand', 'USB-C Cable']);
  });

  it('throws when the Python helper exits non-zero', async () => {
    vi.doMock('child_process', () => ({
      spawn: () => fakeChild('', 2),
    }));
    vi.doMock('../src/amazon/client.js', async (importOriginal) => {
      const mod = await importOriginal<typeof import('../src/amazon/client.js')>();
      return { ...mod, resolvePython: () => '/usr/bin/python3' };
    });

    const { runAmazonSync } = await import('../src/amazon/sync.js');
    await expect(runAmazonSync(db, config, { overrideDays: 30 })).rejects.toThrow(/exited with code 2/);
  });

  it('runAmazonSyncSafe swallows errors and records them in meta', async () => {
    vi.doMock('child_process', () => ({
      spawn: () => fakeChild('', 1),
    }));
    vi.doMock('../src/amazon/client.js', async (importOriginal) => {
      const mod = await importOriginal<typeof import('../src/amazon/client.js')>();
      return { ...mod, resolvePython: () => '/usr/bin/python3' };
    });

    const { runAmazonSyncSafe } = await import('../src/amazon/sync.js');
    const result = await runAmazonSyncSafe(db, config);
    expect(result).toBeNull();

    const lastError = db.prepare("SELECT value FROM meta WHERE key = 'amazon_last_error'").get() as
      | { value: string }
      | undefined;
    expect(lastError?.value).toMatch(/exited with code 1/);
  });

  it('runAmazonSyncSafe is a no-op when feature is disabled', async () => {
    const { runAmazonSyncSafe } = await import('../src/amazon/sync.js');
    const result = await runAmazonSyncSafe(db, { ...config, enabled: false });
    expect(result).toBeNull();
  });
});
