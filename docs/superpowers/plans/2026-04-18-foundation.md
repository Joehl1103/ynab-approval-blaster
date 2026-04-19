# YNAB Blaster — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Node.js project, set up config loading, initialize SQLite with the full schema, and implement YNAB delta sync — producing a working `ynab-blaster sync` command.

**Architecture:** CLI entry point delegates to a `sync` command that loads config from YAML, opens SQLite via `better-sqlite3`, fetches transactions/categories/payees from YNAB using delta sync, persists them, and rebuilds `payee_category_history`. All DB operations are synchronous (better-sqlite3). All YNAB calls are async.

**Tech Stack:** Node.js 20+, TypeScript, `ynab` SDK, `better-sqlite3`, `js-yaml`, `commander`, `vitest`

---

## File Map

| File | Responsibility |
|---|---|
| `src/cli.ts` | Commander entry point — registers subcommands |
| `src/commands/init.ts` | `ynab-blaster init` — walks through PAT + budget selection |
| `src/commands/sync.ts` | `ynab-blaster sync` — runs sync only, no TUI |
| `src/commands/status.ts` | `ynab-blaster status` — prints counts |
| `src/config.ts` | Load, validate, and type config.yml |
| `src/db/schema.ts` | Creates all tables and indexes (idempotent) |
| `src/db/client.ts` | Opens and returns a better-sqlite3 Database instance |
| `src/db/meta.ts` | get/set key-value rows in the `meta` table |
| `src/db/categories.ts` | Upsert categories from YNAB response |
| `src/db/payees.ts` | Upsert payees from YNAB response |
| `src/db/transactions.ts` | Upsert transactions, query unapproved queue |
| `src/db/history.ts` | Rebuild payee_category_history from transactions |
| `src/sync.ts` | Orchestrates YNAB API calls + DB writes for a full delta sync |
| `src/ynab.ts` | Creates and returns the YNAB API client from config |
| `src/format.ts` | Milliunit → dollar string formatter |
| `tests/format.test.ts` | Unit tests for milliunit formatter |
| `tests/history.test.ts` | Unit tests for payee_category_history aggregation |
| `tests/config.test.ts` | Unit tests for config validation |

---

## Task 1: Project scaffold + TypeScript setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/cli.ts`
- Create: `.gitignore`

- [ ] **Step 1: Init npm project**

```bash
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install ynab better-sqlite3 js-yaml commander
npm install --save-dev typescript @types/node @types/better-sqlite3 @types/js-yaml vitest tsx
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Update package.json scripts and bin**

Replace the `scripts` and add `bin` in `package.json`:

```json
{
  "type": "module",
  "bin": {
    "ynab-blaster": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 5: Write src/cli.ts**

```typescript
import { Command } from 'commander';

const program = new Command();

program
  .name('ynab-blaster')
  .description('Rip through YNAB unapproved transactions with single keystrokes')
  .version('0.1.0');

// Subcommands registered here as they are implemented
program.parse(process.argv);
```

- [ ] **Step 6: Update .gitignore**

```
node_modules/
dist/
*.db
.env
*.csv
*.xlsx
.worktrees/
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npm run build
```

Expected: `dist/cli.js` is created with no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json src/cli.ts .gitignore
git commit -m "chore: scaffold Node.js/TypeScript project with commander entry point"
```

---

## Task 2: Config loading

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/config.js';

describe('parseConfig', () => {
  it('parses a valid config object', () => {
    const raw = {
      personal_access_token: 'abc123',
      budget_id: 'uuid-budget',
      db_path: '~/.local/share/ynab-blaster/ynab.db',
      include_hidden_categories: false,
      sort: 'date_desc',
    };
    const config = parseConfig(raw);
    expect(config.personal_access_token).toBe('abc123');
    expect(config.sort).toBe('date_desc');
  });

  it('throws on missing personal_access_token', () => {
    expect(() => parseConfig({ budget_id: 'x', db_path: 'y' })).toThrow(
      'personal_access_token'
    );
  });

  it('throws on invalid sort value', () => {
    expect(() =>
      parseConfig({
        personal_access_token: 'x',
        budget_id: 'y',
        db_path: 'z',
        sort: 'invalid',
      })
    ).toThrow('sort');
  });

  it('defaults include_hidden_categories to false', () => {
    const config = parseConfig({
      personal_access_token: 'x',
      budget_id: 'y',
      db_path: 'z',
    });
    expect(config.include_hidden_categories).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/config.test.ts
```

Expected: FAIL — `parseConfig` not found.

- [ ] **Step 3: Write src/config.ts**

```typescript
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { load } from 'js-yaml';

export type SortOrder = 'date_desc' | 'date_asc' | 'account';

export interface Config {
  personal_access_token: string;
  budget_id: string;
  db_path: string;
  include_hidden_categories: boolean;
  sort: SortOrder;
}

const VALID_SORTS: SortOrder[] = ['date_desc', 'date_asc', 'account'];
const CONFIG_PATH = `${homedir()}/.config/ynab-blaster/config.yml`;

// Validates and coerces a raw YAML-parsed object into a typed Config.
// Throws with a descriptive message pointing to the offending key.
export function parseConfig(raw: Record<string, unknown>): Config {
  if (!raw.personal_access_token || typeof raw.personal_access_token !== 'string') {
    throw new Error('Config error: personal_access_token is required');
  }
  if (!raw.budget_id || typeof raw.budget_id !== 'string') {
    throw new Error('Config error: budget_id is required');
  }
  if (!raw.db_path || typeof raw.db_path !== 'string') {
    throw new Error('Config error: db_path is required');
  }
  const sort = (raw.sort as SortOrder) ?? 'date_desc';
  if (!VALID_SORTS.includes(sort)) {
    throw new Error(`Config error: sort must be one of ${VALID_SORTS.join(', ')}`);
  }
  return {
    personal_access_token: raw.personal_access_token,
    budget_id: raw.budget_id,
    db_path: (raw.db_path as string).replace('~', homedir()),
    include_hidden_categories: (raw.include_hidden_categories as boolean) ?? false,
    sort,
  };
}

export function loadConfig(): Config {
  const raw = load(readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
  return parseConfig(raw);
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- tests/config.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config loading and validation with tests"
```

---

## Task 3: SQLite client + schema

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/schema.ts`

- [ ] **Step 1: Write src/db/client.ts**

```typescript
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// Opens (or creates) the SQLite database at the given path.
// Creates parent directories if they don't exist.
export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  return new Database(dbPath);
}
```

- [ ] **Step 2: Write src/db/schema.ts**

```typescript
import type Database from 'better-sqlite3';

// Applies all table and index definitions idempotently (CREATE IF NOT EXISTS).
export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_name TEXT,
      hidden INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS payees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      deleted INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      amount INTEGER NOT NULL,
      payee_id TEXT,
      payee_name TEXT,
      category_id TEXT,
      category_name TEXT,
      memo TEXT,
      approved INTEGER NOT NULL,
      cleared TEXT,
      account_name TEXT,
      flag_color TEXT,
      deleted INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_tx_approved ON transactions(approved, deleted);
    CREATE INDEX IF NOT EXISTS idx_tx_payee ON transactions(payee_id);

    CREATE TABLE IF NOT EXISTS payee_category_history (
      payee_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      count INTEGER NOT NULL,
      last_used TEXT NOT NULL,
      PRIMARY KEY (payee_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS inflight_writes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}
```

- [ ] **Step 3: Verify schema applies without error (manual check)**

Create a temporary script `scripts/check-schema.ts`:

```typescript
import { openDatabase } from '../src/db/client.js';
import { applySchema } from '../src/db/schema.js';

const db = openDatabase('/tmp/ynab-blaster-test.db');
applySchema(db);
console.log('Schema applied successfully');
db.close();
```

Run: `npx tsx scripts/check-schema.ts`
Expected: `Schema applied successfully`

Delete `scripts/check-schema.ts` after verifying.

- [ ] **Step 4: Commit**

```bash
git add src/db/client.ts src/db/schema.ts
git commit -m "feat: add SQLite client and schema with all tables and indexes"
```

---

## Task 4: Meta, categories, payees DB helpers

**Files:**
- Create: `src/db/meta.ts`
- Create: `src/db/categories.ts`
- Create: `src/db/payees.ts`

- [ ] **Step 1: Write src/db/meta.ts**

```typescript
import type Database from 'better-sqlite3';

// Reads a value from the meta table by key. Returns undefined if not set.
export function getMeta(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

// Writes a value to the meta table, inserting or replacing.
export function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}
```

- [ ] **Step 2: Write src/db/categories.ts**

```typescript
import type Database from 'better-sqlite3';

export interface CategoryRow {
  id: string;
  name: string;
  group_name: string | null;
  hidden: number;
  deleted: number;
}

// Upserts a batch of categories from a YNAB API response.
export function upsertCategories(
  db: Database.Database,
  categories: CategoryRow[]
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO categories (id, name, group_name, hidden, deleted)
    VALUES (@id, @name, @group_name, @hidden, @deleted)
  `);
  const upsertMany = db.transaction((rows: CategoryRow[]) => {
    for (const row of rows) stmt.run(row);
  });
  upsertMany(categories);
}

// Returns all non-deleted categories, optionally including hidden ones.
export function getCategories(
  db: Database.Database,
  includeHidden: boolean
): CategoryRow[] {
  const sql = includeHidden
    ? 'SELECT * FROM categories WHERE deleted = 0'
    : 'SELECT * FROM categories WHERE deleted = 0 AND hidden = 0';
  return db.prepare(sql).all() as CategoryRow[];
}
```

- [ ] **Step 3: Write src/db/payees.ts**

```typescript
import type Database from 'better-sqlite3';

export interface PayeeRow {
  id: string;
  name: string;
  deleted: number;
}

// Upserts a batch of payees from a YNAB API response.
export function upsertPayees(db: Database.Database, payees: PayeeRow[]): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO payees (id, name, deleted)
    VALUES (@id, @name, @deleted)
  `);
  const upsertMany = db.transaction((rows: PayeeRow[]) => {
    for (const row of rows) stmt.run(row);
  });
  upsertMany(payees);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/db/meta.ts src/db/categories.ts src/db/payees.ts
git commit -m "feat: add meta, categories, and payees DB helpers"
```

---

## Task 5: Transactions DB helpers

**Files:**
- Create: `src/db/transactions.ts`

- [ ] **Step 1: Write src/db/transactions.ts**

```typescript
import type Database from 'better-sqlite3';

export interface TransactionRow {
  id: string;
  date: string;
  amount: number;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  memo: string | null;
  approved: number;
  cleared: string | null;
  account_name: string | null;
  flag_color: string | null;
  deleted: number;
}

// Upserts a batch of transactions from a YNAB API response.
export function upsertTransactions(
  db: Database.Database,
  transactions: TransactionRow[]
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO transactions
      (id, date, amount, payee_id, payee_name, category_id, category_name,
       memo, approved, cleared, account_name, flag_color, deleted)
    VALUES
      (@id, @date, @amount, @payee_id, @payee_name, @category_id, @category_name,
       @memo, @approved, @cleared, @account_name, @flag_color, @deleted)
  `);
  const upsertMany = db.transaction((rows: TransactionRow[]) => {
    for (const row of rows) stmt.run(row);
  });
  upsertMany(transactions);
}

// Returns all unapproved, non-deleted transactions in the requested order.
export function getUnapprovedTransactions(
  db: Database.Database,
  sort: 'date_desc' | 'date_asc' | 'account'
): TransactionRow[] {
  const orderBy =
    sort === 'date_asc'
      ? 'date ASC'
      : sort === 'account'
      ? 'account_name ASC, date DESC'
      : 'date DESC';
  return db
    .prepare(
      `SELECT * FROM transactions WHERE approved = 0 AND deleted = 0 ORDER BY ${orderBy}`
    )
    .all() as TransactionRow[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/transactions.ts
git commit -m "feat: add transactions DB helpers with upsert and unapproved queue query"
```

---

## Task 6: Payee category history aggregation

**Files:**
- Create: `src/db/history.ts`
- Create: `tests/history.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/history.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '../src/db/client.js';
import { applySchema } from '../src/db/schema.js';
import { upsertTransactions } from '../src/db/transactions.js';
import { rebuildPayeeCategoryHistory, getPayeeHistory } from '../src/db/history.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = openDatabase(':memory:');
  applySchema(db);
});

describe('rebuildPayeeCategoryHistory', () => {
  it('counts approved transactions per (payee, category) pair', () => {
    upsertTransactions(db, [
      {
        id: 't1', date: '2026-01-01', amount: -50000, payee_id: 'p1',
        payee_name: 'TARGET', category_id: 'c1', category_name: 'Groceries',
        memo: null, approved: 1, cleared: 'cleared', account_name: 'Checking',
        flag_color: null, deleted: 0,
      },
      {
        id: 't2', date: '2026-01-02', amount: -30000, payee_id: 'p1',
        payee_name: 'TARGET', category_id: 'c1', category_name: 'Groceries',
        memo: null, approved: 1, cleared: 'cleared', account_name: 'Checking',
        flag_color: null, deleted: 0,
      },
      {
        id: 't3', date: '2026-01-03', amount: -20000, payee_id: 'p1',
        payee_name: 'TARGET', category_id: 'c2', category_name: 'Household',
        memo: null, approved: 1, cleared: 'cleared', account_name: 'Checking',
        flag_color: null, deleted: 0,
      },
    ]);

    rebuildPayeeCategoryHistory(db);

    const history = getPayeeHistory(db, 'p1');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ category_id: 'c1', count: 2 });
    expect(history[1]).toMatchObject({ category_id: 'c2', count: 1 });
  });

  it('excludes unapproved transactions', () => {
    upsertTransactions(db, [
      {
        id: 't1', date: '2026-01-01', amount: -50000, payee_id: 'p1',
        payee_name: 'TARGET', category_id: 'c1', category_name: 'Groceries',
        memo: null, approved: 0, cleared: 'uncleared', account_name: 'Checking',
        flag_color: null, deleted: 0,
      },
    ]);
    rebuildPayeeCategoryHistory(db);
    expect(getPayeeHistory(db, 'p1')).toHaveLength(0);
  });

  it('excludes deleted transactions', () => {
    upsertTransactions(db, [
      {
        id: 't1', date: '2026-01-01', amount: -50000, payee_id: 'p1',
        payee_name: 'TARGET', category_id: 'c1', category_name: 'Groceries',
        memo: null, approved: 1, cleared: 'cleared', account_name: 'Checking',
        flag_color: null, deleted: 1,
      },
    ]);
    rebuildPayeeCategoryHistory(db);
    expect(getPayeeHistory(db, 'p1')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/history.test.ts
```

Expected: FAIL — `rebuildPayeeCategoryHistory` not found.

- [ ] **Step 3: Write src/db/history.ts**

```typescript
import type Database from 'better-sqlite3';

export interface HistoryRow {
  payee_id: string;
  category_id: string;
  count: number;
  last_used: string;
}

// Rebuilds the payee_category_history table from all approved, non-deleted transactions.
// Called after every sync. Full replace — deletes all rows first, then re-aggregates.
export function rebuildPayeeCategoryHistory(db: Database.Database): void {
  db.transaction(() => {
    db.prepare('DELETE FROM payee_category_history').run();
    db.prepare(`
      INSERT INTO payee_category_history (payee_id, category_id, count, last_used)
      SELECT
        payee_id,
        category_id,
        COUNT(*) AS count,
        MAX(date) AS last_used
      FROM transactions
      WHERE approved = 1
        AND deleted = 0
        AND payee_id IS NOT NULL
        AND category_id IS NOT NULL
      GROUP BY payee_id, category_id
    `).run();
  })();
}

// Returns history rows for a payee sorted by count descending (most-used first).
export function getPayeeHistory(db: Database.Database, payeeId: string): HistoryRow[] {
  return db
    .prepare(
      `SELECT * FROM payee_category_history
       WHERE payee_id = ?
       ORDER BY count DESC`
    )
    .all(payeeId) as HistoryRow[];
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- tests/history.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/history.ts tests/history.test.ts
git commit -m "feat: add payee_category_history rebuild and query with tests"
```

---

## Task 7: Milliunit formatter

**Files:**
- Create: `src/format.ts`
- Create: `tests/format.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatMilliunits } from '../src/format.js';

describe('formatMilliunits', () => {
  it('formats a negative amount as a dollar string', () => {
    expect(formatMilliunits(-84220)).toBe('-$84.22');
  });

  it('formats a positive amount (inflow)', () => {
    expect(formatMilliunits(100000)).toBe('+$100.00');
  });

  it('formats zero', () => {
    expect(formatMilliunits(0)).toBe('$0.00');
  });

  it('formats large amounts', () => {
    expect(formatMilliunits(-1234567)).toBe('-$1,234.57');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/format.test.ts
```

Expected: FAIL — `formatMilliunits` not found.

- [ ] **Step 3: Write src/format.ts**

```typescript
// YNAB stores amounts as milliunits (1/1000 of a currency unit).
// This converts to a display string: -84220 → "-$84.22", 100000 → "+$100.00"
export function formatMilliunits(milliunits: number): string {
  const dollars = milliunits / 1000;
  const abs = Math.abs(dollars);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (milliunits > 0) return `+$${formatted}`;
  if (milliunits < 0) return `-$${formatted}`;
  return `$${formatted}`;
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npm test -- tests/format.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/format.ts tests/format.test.ts
git commit -m "feat: add milliunit formatter with tests"
```

---

## Task 8: YNAB API client wrapper

**Files:**
- Create: `src/ynab.ts`

- [ ] **Step 1: Write src/ynab.ts**

```typescript
import * as ynab from 'ynab';
import type { Config } from './config.js';

// Creates a YNAB API client using the personal access token from config.
export function createYnabClient(config: Config): ynab.API {
  return new ynab.API(config.personal_access_token);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ynab.ts
git commit -m "feat: add YNAB API client factory"
```

---

## Task 9: Sync orchestrator

**Files:**
- Create: `src/sync.ts`

- [ ] **Step 1: Write src/sync.ts**

```typescript
import type Database from 'better-sqlite3';
import type * as ynab from 'ynab';
import type { Config } from './config.js';
import { getMeta, setMeta } from './db/meta.js';
import { upsertCategories, type CategoryRow } from './db/categories.js';
import { upsertPayees, type PayeeRow } from './db/payees.js';
import { upsertTransactions, type TransactionRow } from './db/transactions.js';
import { rebuildPayeeCategoryHistory } from './db/history.js';

export interface SyncResult {
  categoriesUpdated: number;
  payeesUpdated: number;
  transactionsUpdated: number;
  serverKnowledge: number;
}

// Runs a delta sync against YNAB. On first call, fetches everything.
// On subsequent calls, passes the stored server_knowledge value to get only changes.
// Updates meta.server_knowledge after a successful sync.
export async function syncFromYnab(
  db: Database.Database,
  api: ynab.API,
  config: Config
): Promise<SyncResult> {
  const storedKnowledge = getMeta(db, 'server_knowledge');
  const lastKnowledge = storedKnowledge !== undefined ? parseInt(storedKnowledge, 10) : undefined;

  const [categoriesRes, payeesRes, transactionsRes] = await Promise.all([
    api.categories.getCategories(config.budget_id, lastKnowledge),
    api.payees.getPayees(config.budget_id, lastKnowledge),
    api.transactions.getTransactions(config.budget_id, undefined, undefined, lastKnowledge),
  ]);

  // Flatten category groups into individual category rows
  const categories: CategoryRow[] = categoriesRes.data.category_groups.flatMap((group) =>
    group.categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      group_name: group.name,
      hidden: cat.hidden ? 1 : 0,
      deleted: cat.deleted ? 1 : 0,
    }))
  );

  const payees: PayeeRow[] = payeesRes.data.payees.map((p) => ({
    id: p.id,
    name: p.name,
    deleted: p.deleted ? 1 : 0,
  }));

  const transactions: TransactionRow[] = transactionsRes.data.transactions.map((t) => ({
    id: t.id,
    date: t.date,
    amount: t.amount,
    payee_id: t.payee_id ?? null,
    payee_name: t.payee_name ?? null,
    category_id: t.category_id ?? null,
    category_name: t.category_name ?? null,
    memo: t.memo ?? null,
    approved: t.approved ? 1 : 0,
    cleared: t.cleared ?? null,
    account_name: t.account_name ?? null,
    flag_color: t.flag_color ?? null,
    deleted: t.deleted ? 1 : 0,
  }));

  upsertCategories(db, categories);
  upsertPayees(db, payees);
  upsertTransactions(db, transactions);
  rebuildPayeeCategoryHistory(db);

  // Use the highest server_knowledge returned across all three endpoints
  const newKnowledge = Math.max(
    categoriesRes.data.server_knowledge,
    payeesRes.data.server_knowledge,
    transactionsRes.data.server_knowledge
  );
  setMeta(db, 'server_knowledge', String(newKnowledge));
  setMeta(db, 'last_sync_at', new Date().toISOString());

  return {
    categoriesUpdated: categories.length,
    payeesUpdated: payees.length,
    transactionsUpdated: transactions.length,
    serverKnowledge: newKnowledge,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/sync.ts
git commit -m "feat: add YNAB delta sync orchestrator"
```

---

## Task 10: CLI subcommands — sync, status, init

**Files:**
- Create: `src/commands/sync.ts`
- Create: `src/commands/status.ts`
- Create: `src/commands/init.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write src/commands/sync.ts**

```typescript
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { applySchema } from '../db/schema.js';
import { createYnabClient } from '../ynab.js';
import { syncFromYnab } from '../sync.js';

// `ynab-blaster sync` — syncs from YNAB and prints a summary. No TUI.
export async function runSync(): Promise<void> {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  applySchema(db);
  const api = createYnabClient(config);

  console.log('Syncing from YNAB...');
  const result = await syncFromYnab(db, api, config);
  console.log(`Sync complete.`);
  console.log(`  Categories: ${result.categoriesUpdated}`);
  console.log(`  Payees:     ${result.payeesUpdated}`);
  console.log(`  Transactions: ${result.transactionsUpdated}`);
  console.log(`  Server knowledge: ${result.serverKnowledge}`);
  db.close();
}
```

- [ ] **Step 2: Write src/commands/status.ts**

```typescript
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { applySchema } from '../db/schema.js';
import { getUnapprovedTransactions } from '../db/transactions.js';
import { getMeta } from '../db/meta.js';

// `ynab-blaster status` — prints counts without entering TUI.
export function runStatus(): void {
  const config = loadConfig();
  const db = openDatabase(config.db_path);
  applySchema(db);

  const unapproved = getUnapprovedTransactions(db, config.sort);
  const inflight = db
    .prepare('SELECT COUNT(*) as count FROM inflight_writes')
    .get() as { count: number };
  const lastSync = getMeta(db, 'last_sync_at') ?? 'never';

  console.log(`Unapproved transactions: ${unapproved.length}`);
  console.log(`Inflight writes:         ${inflight.count}`);
  console.log(`Last synced:             ${lastSync}`);
  db.close();
}
```

- [ ] **Step 3: Write src/commands/init.ts**

```typescript
import { createInterface } from 'readline';
import { writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as ynab from 'ynab';
import { dump } from 'js-yaml';

const CONFIG_DIR = join(homedir(), '.config', 'ynab-blaster');
const CONFIG_PATH = join(CONFIG_DIR, 'config.yml');

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// `ynab-blaster init` — interactive first-time setup.
// Asks for PAT, lists budgets, writes config.yml.
export async function runInit(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('Welcome to YNAB Blaster setup.\n');
  const pat = await prompt(rl, 'Enter your YNAB Personal Access Token: ');

  let budgets: { id: string; name: string }[] = [];
  try {
    const api = new ynab.API(pat.trim());
    const res = await api.budgets.getBudgets();
    budgets = res.data.budgets.map((b) => ({ id: b.id, name: b.name }));
  } catch {
    console.error('Failed to connect to YNAB. Check your token and try again.');
    rl.close();
    process.exit(1);
  }

  console.log('\nAvailable budgets:');
  budgets.forEach((b, i) => console.log(`  ${i + 1}. ${b.name}`));
  const choice = await prompt(rl, '\nEnter budget number: ');
  const idx = parseInt(choice.trim(), 10) - 1;

  if (idx < 0 || idx >= budgets.length) {
    console.error('Invalid choice.');
    rl.close();
    process.exit(1);
  }

  const budget = budgets[idx];
  const dbPath = join(homedir(), '.local', 'share', 'ynab-blaster', 'ynab.db');

  const config = {
    personal_access_token: pat.trim(),
    budget_id: budget.id,
    db_path: dbPath,
    include_hidden_categories: false,
    sort: 'date_desc',
  };

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, dump(config), 'utf8');
  console.log(`\nConfig written to ${CONFIG_PATH}`);
  console.log(`Budget: ${budget.name}`);
  console.log('\nRun `ynab-blaster sync` to pull your transactions.');
  rl.close();
}
```

- [ ] **Step 4: Update src/cli.ts to register subcommands**

```typescript
import { Command } from 'commander';

const program = new Command();

program
  .name('ynab-blaster')
  .description('Rip through YNAB unapproved transactions with single keystrokes')
  .version('0.1.0');

program
  .command('init')
  .description('First-time setup: configure PAT and budget')
  .action(async () => {
    const { runInit } = await import('./commands/init.js');
    await runInit();
  });

program
  .command('sync')
  .description('Sync from YNAB without entering TUI')
  .action(async () => {
    const { runSync } = await import('./commands/sync.js');
    await runSync();
  });

program
  .command('status')
  .description('Show unapproved count and inflight writes')
  .action(() => {
    const { runStatus } = await import('./commands/status.js');
    runStatus();
  });

program.parse(process.argv);
```

- [ ] **Step 5: Build and verify CLI commands are registered**

```bash
npm run build && node dist/cli.js --help
```

Expected output includes: `init`, `sync`, `status` subcommands listed.

- [ ] **Step 6: Commit**

```bash
git add src/commands/sync.ts src/commands/status.ts src/commands/init.ts src/cli.ts
git commit -m "feat: add init, sync, and status CLI subcommands"
```

---

## Task 11: Run all tests + verify build

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass (config, history, format).

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: plan 1 complete — foundation, sync, CLI subcommands"
```
