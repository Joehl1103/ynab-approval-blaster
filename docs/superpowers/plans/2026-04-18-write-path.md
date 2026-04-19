# YNAB Blaster — Plan 2: Write Path + Crash Safety

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the per-approval write path — optimistic local update, inflight_writes journal, async YNAB API call, success/failure handling, undo, and startup replay of unconfirmed writes.

**Architecture:** A `WriteManager` class owns the inflight journal and exposes methods for each change type (approve, recategorize, memo, flag). Each write: (1) updates SQLite optimistically, (2) inserts an inflight row, (3) fires the YNAB API call async, (4) deletes the inflight row on success or restores the prior state on failure. An in-memory `Map<txId, Promise>` prevents racing writes to the same transaction. Startup replay checks the inflight table and retries any survivors.

**Tech Stack:** Node.js 20+, TypeScript, `ynab` SDK, `better-sqlite3`, `vitest`

**Depends on:** Plan 1 (Foundation) — all DB helpers and types must be in place.

---

## File Map

| File | Responsibility |
|---|---|
| `src/db/inflight.ts` | Insert, delete, and list inflight_writes rows |
| `src/write-manager.ts` | Owns write lifecycle: optimistic update → API call → confirm/rollback |
| `src/commands/retry-inflight.ts` | `ynab-blaster retry-inflight` CLI subcommand |
| `tests/inflight.test.ts` | Unit tests for inflight DB helpers |
| `tests/write-manager.test.ts` | Unit tests for WriteManager state transitions |

---

## Task 1: Inflight DB helpers

**Files:**
- Create: `src/db/inflight.ts`
- Create: `tests/inflight.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/inflight.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/inflight.test.ts
```

Expected: FAIL — `insertInflight` not found.

- [ ] **Step 3: Write src/db/inflight.ts**

```typescript
import type Database from 'better-sqlite3';

export interface InflightRow {
  id: number;
  transaction_id: string;
  change_type: string;
  payload: string;
  created_at: string;
}

export interface InflightInsert {
  transaction_id: string;
  change_type: string;
  payload: string;
}

// Inserts a new inflight_writes row before firing an API call. Returns the row id.
export function insertInflight(db: Database.Database, row: InflightInsert): number {
  const result = db
    .prepare(
      `INSERT INTO inflight_writes (transaction_id, change_type, payload, created_at)
       VALUES (@transaction_id, @change_type, @payload, @created_at)`
    )
    .run({ ...row, created_at: new Date().toISOString() });
  return result.lastInsertRowid as number;
}

// Deletes an inflight row after the API call confirms success.
export function deleteInflight(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM inflight_writes WHERE id = ?').run(id);
}

// Returns all surviving inflight rows, ordered by creation time (oldest first).
export function listInflight(db: Database.Database): InflightRow[] {
  return db
    .prepare('SELECT * FROM inflight_writes ORDER BY created_at ASC')
    .all() as InflightRow[];
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- tests/inflight.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/inflight.ts tests/inflight.test.ts
git commit -m "feat: add inflight_writes DB helpers with tests"
```

---

## Task 2: WriteManager

**Files:**
- Create: `src/write-manager.ts`
- Create: `tests/write-manager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/write-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDatabase } from '../src/db/client.js';
import { applySchema } from '../src/db/schema.js';
import { upsertTransactions } from '../src/db/transactions.js';
import { listInflight } from '../src/db/inflight.js';
import { WriteManager } from '../src/write-manager.js';
import type Database from 'better-sqlite3';
import type * as ynab from 'ynab';

let db: Database.Database;

const baseTx = {
  id: 'tx1',
  date: '2026-01-01',
  amount: -50000,
  payee_id: 'p1',
  payee_name: 'TARGET',
  category_id: 'c1',
  category_name: 'Groceries',
  memo: null,
  approved: 0,
  cleared: 'uncleared',
  account_name: 'Checking',
  flag_color: null,
  deleted: 0,
};

beforeEach(() => {
  db = openDatabase(':memory:');
  applySchema(db);
  upsertTransactions(db, [baseTx]);
});

describe('WriteManager.approve', () => {
  it('optimistically marks transaction approved in SQLite', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await manager.approve('tx1', 'c1');

    const row = db
      .prepare('SELECT approved FROM transactions WHERE id = ?')
      .get('tx1') as { approved: number };
    expect(row.approved).toBe(1);
  });

  it('clears inflight row after successful API call', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await manager.approve('tx1', 'c1');

    expect(listInflight(db)).toHaveLength(0);
  });

  it('rolls back optimistic update on API failure', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await expect(manager.approve('tx1', 'c1')).rejects.toThrow('Network error');

    const row = db
      .prepare('SELECT approved FROM transactions WHERE id = ?')
      .get('tx1') as { approved: number };
    expect(row.approved).toBe(0);
  });

  it('leaves inflight row in place on API failure', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await expect(manager.approve('tx1', 'c1')).rejects.toThrow();

    expect(listInflight(db)).toHaveLength(1);
  });
});

describe('WriteManager.recategorize', () => {
  it('updates category_id and category_name optimistically', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await manager.recategorize('tx1', 'c2', 'Household');

    const row = db
      .prepare('SELECT category_id, category_name FROM transactions WHERE id = ?')
      .get('tx1') as { category_id: string; category_name: string };
    expect(row.category_id).toBe('c2');
    expect(row.category_name).toBe('Household');
  });
});

describe('WriteManager.editMemo', () => {
  it('updates memo optimistically', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await manager.editMemo('tx1', 'birthday gift');

    const row = db
      .prepare('SELECT memo FROM transactions WHERE id = ?')
      .get('tx1') as { memo: string };
    expect(row.memo).toBe('birthday gift');
  });
});

describe('WriteManager.flagForSplit', () => {
  it('sets flag_color to purple', async () => {
    const mockApi = {
      transactions: {
        updateTransaction: vi.fn().mockResolvedValue({}),
      },
    } as unknown as ynab.API;

    const manager = new WriteManager(db, mockApi, 'budget-1');
    await manager.flagForSplit('tx1');

    const row = db
      .prepare('SELECT flag_color FROM transactions WHERE id = ?')
      .get('tx1') as { flag_color: string };
    expect(row.flag_color).toBe('purple');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/write-manager.test.ts
```

Expected: FAIL — `WriteManager` not found.

- [ ] **Step 3: Write src/write-manager.ts**

```typescript
import type Database from 'better-sqlite3';
import type * as ynab from 'ynab';
import { insertInflight, deleteInflight } from './db/inflight.js';

// Payload stored in inflight_writes so we can roll back on failure.
interface ApprovePayload {
  prev_approved: number;
  prev_category_id: string | null;
  category_id: string;
}

interface RecategorizePayload {
  prev_category_id: string | null;
  prev_category_name: string | null;
  category_id: string;
  category_name: string;
}

interface MemoPayload {
  prev_memo: string | null;
  memo: string;
}

interface FlagPayload {
  prev_flag_color: string | null;
}

// Manages the lifecycle of every YNAB write:
// 1. Optimistic SQLite update
// 2. Insert inflight row (for crash recovery)
// 3. Fire YNAB API call
// 4. On success: delete inflight row
// 5. On failure: rollback SQLite, leave inflight row
//
// An in-memory set tracks in-flight transaction IDs to prevent racing writes.
export class WriteManager {
  private inFlight = new Set<string>();

  constructor(
    private db: Database.Database,
    private api: ynab.API,
    private budgetId: string
  ) {}

  // Approves a transaction with the given category. Writes to YNAB immediately.
  async approve(transactionId: string, categoryId: string): Promise<void> {
    const prev = this.db
      .prepare('SELECT approved, category_id FROM transactions WHERE id = ?')
      .get(transactionId) as { approved: number; category_id: string | null };

    const payload: ApprovePayload = {
      prev_approved: prev.approved,
      prev_category_id: prev.category_id,
      category_id: categoryId,
    };

    this.db
      .prepare(
        'UPDATE transactions SET approved = 1, category_id = ? WHERE id = ?'
      )
      .run(categoryId, transactionId);

    const inflightId = insertInflight(this.db, {
      transaction_id: transactionId,
      change_type: 'approve',
      payload: JSON.stringify(payload),
    });

    try {
      await this.api.transactions.updateTransaction(this.budgetId, transactionId, {
        transaction: { approved: true, category_id: categoryId },
      });
      deleteInflight(this.db, inflightId);
    } catch (err) {
      this.db
        .prepare(
          'UPDATE transactions SET approved = ?, category_id = ? WHERE id = ?'
        )
        .run(payload.prev_approved, payload.prev_category_id, transactionId);
      throw err;
    }
  }

  // Changes category without approving. Writes to YNAB immediately.
  async recategorize(
    transactionId: string,
    categoryId: string,
    categoryName: string
  ): Promise<void> {
    const prev = this.db
      .prepare('SELECT category_id, category_name FROM transactions WHERE id = ?')
      .get(transactionId) as { category_id: string | null; category_name: string | null };

    const payload: RecategorizePayload = {
      prev_category_id: prev.category_id,
      prev_category_name: prev.category_name,
      category_id: categoryId,
      category_name: categoryName,
    };

    this.db
      .prepare(
        'UPDATE transactions SET category_id = ?, category_name = ? WHERE id = ?'
      )
      .run(categoryId, categoryName, transactionId);

    const inflightId = insertInflight(this.db, {
      transaction_id: transactionId,
      change_type: 'recategorize',
      payload: JSON.stringify(payload),
    });

    try {
      await this.api.transactions.updateTransaction(this.budgetId, transactionId, {
        transaction: { category_id: categoryId },
      });
      deleteInflight(this.db, inflightId);
    } catch (err) {
      this.db
        .prepare(
          'UPDATE transactions SET category_id = ?, category_name = ? WHERE id = ?'
        )
        .run(payload.prev_category_id, payload.prev_category_name, transactionId);
      throw err;
    }
  }

  // Updates the memo field. Writes to YNAB immediately.
  async editMemo(transactionId: string, memo: string): Promise<void> {
    const prev = this.db
      .prepare('SELECT memo FROM transactions WHERE id = ?')
      .get(transactionId) as { memo: string | null };

    const payload: MemoPayload = { prev_memo: prev.memo, memo };

    this.db
      .prepare('UPDATE transactions SET memo = ? WHERE id = ?')
      .run(memo, transactionId);

    const inflightId = insertInflight(this.db, {
      transaction_id: transactionId,
      change_type: 'memo',
      payload: JSON.stringify(payload),
    });

    try {
      await this.api.transactions.updateTransaction(this.budgetId, transactionId, {
        transaction: { memo },
      });
      deleteInflight(this.db, inflightId);
    } catch (err) {
      this.db
        .prepare('UPDATE transactions SET memo = ? WHERE id = ?')
        .run(payload.prev_memo, transactionId);
      throw err;
    }
  }

  // Sets flag_color to purple (signals "needs split"). Writes to YNAB immediately.
  async flagForSplit(transactionId: string): Promise<void> {
    const prev = this.db
      .prepare('SELECT flag_color FROM transactions WHERE id = ?')
      .get(transactionId) as { flag_color: string | null };

    const payload: FlagPayload = { prev_flag_color: prev.flag_color };

    this.db
      .prepare("UPDATE transactions SET flag_color = 'purple' WHERE id = ?")
      .run(transactionId);

    const inflightId = insertInflight(this.db, {
      transaction_id: transactionId,
      change_type: 'flag',
      payload: JSON.stringify(payload),
    });

    try {
      await this.api.transactions.updateTransaction(this.budgetId, transactionId, {
        transaction: { flag_color: 'purple' as ynab.TransactionDetail.FlagColorEnum },
      });
      deleteInflight(this.db, inflightId);
    } catch (err) {
      this.db
        .prepare('UPDATE transactions SET flag_color = ? WHERE id = ?')
        .run(payload.prev_flag_color, transactionId);
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- tests/write-manager.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/write-manager.ts tests/write-manager.test.ts
git commit -m "feat: add WriteManager with optimistic updates, rollback, and inflight journal"
```

---

## Task 3: Startup inflight replay

**Files:**
- Create: `src/replay.ts`

- [ ] **Step 1: Write src/replay.ts**

```typescript
import type Database from 'better-sqlite3';
import type * as ynab from 'ynab';
import { listInflight, deleteInflight } from './db/inflight.js';

export interface ReplayResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

// Replays all surviving inflight_writes rows against the YNAB API.
// Called at startup when inflight rows are found. Idempotent — YNAB accepts duplicate PATCHes.
export async function replayInflightWrites(
  db: Database.Database,
  api: ynab.API,
  budgetId: string
): Promise<ReplayResult> {
  const rows = listInflight(db);
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;

    let patch: Record<string, unknown> = {};
    if (row.change_type === 'approve') {
      patch = { approved: true, category_id: payload.category_id };
    } else if (row.change_type === 'recategorize') {
      patch = { category_id: payload.category_id };
    } else if (row.change_type === 'memo') {
      patch = { memo: payload.memo };
    } else if (row.change_type === 'flag') {
      patch = { flag_color: 'purple' };
    }

    try {
      await api.transactions.updateTransaction(budgetId, row.transaction_id, {
        transaction: patch as ynab.SaveTransaction,
      });
      deleteInflight(db, row.id);
      succeeded++;
    } catch {
      failed++;
    }
  }

  return { attempted: rows.length, succeeded, failed };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/replay.ts
git commit -m "feat: add startup inflight replay for crash recovery"
```

---

## Task 4: retry-inflight CLI subcommand

**Files:**
- Create: `src/commands/retry-inflight.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write src/commands/retry-inflight.ts**

```typescript
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { applySchema } from '../db/schema.js';
import { createYnabClient } from '../ynab.js';
import { listInflight } from '../db/inflight.js';
import { replayInflightWrites } from '../replay.js';

// `ynab-blaster retry-inflight` — force-retries any surviving inflight_writes rows.
export async function runRetryInflight(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  applySchema(db);

  const rows = listInflight(db);
  if (rows.length === 0) {
    console.log('No inflight writes to retry.');
    db.close();
    return;
  }

  console.log(`Retrying ${rows.length} inflight write(s)...`);
  const api = createYnabClient(config);
  const result = await replayInflightWrites(db, api, config.budget_id);

  console.log(`  Succeeded: ${result.succeeded}`);
  console.log(`  Failed:    ${result.failed}`);
  db.close();
}
```

- [ ] **Step 2: Register in src/cli.ts**

Add after the `status` command block:

```typescript
program
  .command('retry-inflight')
  .description('Force-retry any writes that did not confirm in a prior session')
  .action(async () => {
    const { runRetryInflight } = await import('./commands/retry-inflight.js');
    await runRetryInflight();
  });
```

- [ ] **Step 3: Build and verify**

```bash
npm run build && node dist/cli.js --help
```

Expected: `retry-inflight` appears in the subcommand list.

- [ ] **Step 4: Commit**

```bash
git add src/commands/retry-inflight.ts src/cli.ts
git commit -m "feat: add retry-inflight CLI subcommand"
```

---

## Task 5: Run all tests + build

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass (config, history, format, inflight, write-manager).

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: plan 2 complete — write path, crash safety, inflight replay"
```
