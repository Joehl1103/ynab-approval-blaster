# YNAB Approval Blaster — v1 Spec

## Purpose
Terminal app that rips through YNAB's unapproved transaction queue with single keystrokes, using local payee history as the primary categorization signal. Single keystrokes replace YNAB web's click-heavy approval flow.

## Non-goals (v1)
- No rules engine
- No confidence-based auto-approve
- No split creation (flag transactions for manual split in web UI)
- No new-transaction entry, transfer handling, or reconciliation
- Single budget, configured once

## Success criteria
- Approving 30 unapproved transactions takes under 2 minutes
- Never silently mutates YNAB — every write is user-initiated
- Survives mid-session crash without losing queued approvals

## Stack
- **Runtime:** Node.js 20+ (matches your skill set)
- **API:** `ynab` official SDK (npm)
- **Local store:** `better-sqlite3` (synchronous, small, no server)
- **TUI:** raw stdin + ANSI escape codes via the `readline` module. `ink` (React-in-terminal) is tempting but overkill for single-screen flow and adds dependency weight. Recommendation: raw stdin. Reconsider if you want a split editor in v2.
- **Config:** YAML via `js-yaml`
- **CLI args:** `commander`

## Data model (SQLite)

```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- stores: server_knowledge, budget_id, last_sync_at

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_name TEXT,
  hidden INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0
);

CREATE TABLE payees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  deleted INTEGER DEFAULT 0
);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,        -- YNAB milliunits
  payee_id TEXT,
  payee_name TEXT,                -- denormalized for speed
  category_id TEXT,
  category_name TEXT,             -- denormalized
  memo TEXT,
  approved INTEGER NOT NULL,
  cleared TEXT,
  account_name TEXT,
  flag_color TEXT,
  deleted INTEGER DEFAULT 0
);

CREATE INDEX idx_tx_approved ON transactions(approved, deleted);
CREATE INDEX idx_tx_payee ON transactions(payee_id);

-- Rebuilt from transactions table on each sync.
-- Only counts approved, non-deleted transactions.
CREATE TABLE payee_category_history (
  payee_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  count INTEGER NOT NULL,
  last_used TEXT NOT NULL,
  PRIMARY KEY (payee_id, category_id)
);

-- Crash-safety journal. Pending writes flushed to YNAB on quit.
-- If app crashes mid-session, replay on next startup.
CREATE TABLE pending_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  change_type TEXT NOT NULL,      -- approve | recategorize | memo | flag
  payload TEXT NOT NULL,          -- JSON
  created_at TEXT NOT NULL
);
```

## Sync strategy
- Use YNAB's delta sync: pass `last_knowledge_of_server` from `meta` table on every `getTransactions`, `getCategories`, `getPayees` call.
- On first run, no knowledge value → full pull.
- Store returned `server_knowledge` back to `meta` after each sync.
- Rebuild `payee_category_history` after each sync: single aggregate query grouping approved transactions by (payee_id, category_id).

## Startup flow
1. Load config.
2. Check `pending_changes` — if non-empty, prompt: "N pending changes from prior session. Replay? [y/N]".
3. Sync from YNAB.
4. Load queue: all rows where `approved = 0 AND deleted = 0`, sorted by date desc.
5. Enter TUI.

## TUI — single transaction screen

```
[3/47]  2026-04-15  TARGET #1847  -$84.22  Chase Checking

  Memo: (none)

  History for TARGET #1847:
    Groceries    64%  (26)
    Household    28%  (11)
    Kids          8%  ( 3)

  Suggested: Groceries

  [y] approve as Groceries     [c] change category
  [n] next (no change)         [s] skip
  [x] flag for split           [m] edit memo
  [u] undo last                [q] save & quit
```

Payee with no history shows: `History: (no prior approvals for this payee)` and no suggestion — user must press `c`.

## Category picker (invoked by `c`)
- Fuzzy-match substring filter (case-insensitive) across `categories.name`
- Up/down arrows to cycle
- Enter to select
- Esc to cancel back to main screen
- Hidden categories excluded by default; flag to include

## Keybindings

| Key | Action |
|---|---|
| `y` / enter | Approve with suggested category |
| `c` | Open category picker |
| `n` | Advance without change |
| `s` | Skip (remains unapproved, not flagged) |
| `x` | Flag for split (sets `flag_color=purple`, advances, no approval) |
| `m` | Edit memo inline |
| `u` | Undo last pending change |
| `q` | Flush pending changes to YNAB, then exit |
| `Q` | Quit without flushing (prompts confirm) |

## Write path
- Every action queues a row in `pending_changes`.
- On `q`: group by change_type, batch-POST using YNAB's `updateTransactions` bulk endpoint (supports up to several hundred per call).
- On successful 200, delete corresponding `pending_changes` rows.
- On partial failure, print which transaction IDs failed and leave their rows in `pending_changes` for retry.

## Config file
Location: `~/.config/ynab-blaster/config.yml`

```yaml
personal_access_token: <pat>
budget_id: <uuid>
db_path: ~/.local/share/ynab-blaster/ynab.db
include_hidden_categories: false
sort: date_desc          # date_desc | date_asc | account
```

Bootstrap: `ynab-blaster init` walks through PAT entry, lists budgets from API, user picks one, writes config.

## CLI surface

```
ynab-blaster init              # first-time setup
ynab-blaster                   # run the blaster (default)
ynab-blaster sync              # sync only, don't enter TUI
ynab-blaster status            # show counts: unapproved, pending writes
ynab-blaster replay-pending    # force-flush any pending_changes
```

## Error handling
- **401**: PAT expired or revoked. Print clear message, point to `init`.
- **429**: exponential backoff. YNAB allows 200 req/hour per token — unlikely to hit in normal use.
- **Network failure mid-sync**: abort sync, keep stale local data, warn user, offer to continue with stale queue.
- **Network failure mid-flush**: see write path — partial failures persist in `pending_changes`.
- **Malformed config**: specific error pointing to the offending key.

## Testing expectations
- Unit tests for: category picker fuzzy match, payee history aggregation, milliunit formatting.
- Integration test against a dedicated test budget (fresh YNAB budget with seeded data) covering sync → approve → flush cycle. Hide behind `YNAB_TEST_BUDGET_ID` env var so CI can skip if missing.
- No mocking the YNAB API in integration tests — use a real test budget. Mocks lie.

## Explicitly deferred to v2+
- Rules engine (YAML-driven pre-categorization)
- Confidence-gated silent auto-approve
- Split editor with pre-populated categories
- Payee fuzzy grouping (STARBUCKS #2345 ≈ STARBUCKS #6789)
- Learning prompt ("always categorize X as Y?")
- Multi-budget support

## Open questions to resolve during implementation
1. When a transaction has `payee_id = null` but a `payee_name` string (imported matched payee not yet resolved), match history by name fallback or treat as no-history? **Suggested:** fallback to name exact-match.
2. Transfer transactions appear as unapproved in both accounts — suppress one side or show both? **Suggested:** show both; let user approve each; YNAB dedupes category logic on its side.
3. How to visually distinguish inflows (positive amounts)? **Suggested:** green amount, and skip "approve as <category>" for income category by default.

---

Want me to save this as `SPEC.md` so you can drop it straight into the repo?
