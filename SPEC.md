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
- Survives mid-session crash without losing queued approvals or double-writing

## Stack
- **Runtime:** Node.js 20+
- **API:** `ynab` official SDK (npm)
- **Local store:** `better-sqlite3` (synchronous, small, no server)
- **TUI:** `ink` (React for CLIs) with these companion packages:
  - `ink-select-input` — category picker
  - `ink-text-input` — memo editing
  - `ink-spinner` — sync + per-write indicators
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

-- Crash-safety journal for in-flight writes only.
-- Row inserted BEFORE API call; deleted AFTER success.
-- On startup, any surviving rows are replayed (idempotently).
CREATE TABLE inflight_writes (
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

## Write path — per-approval, not batched

Every keystroke that mutates a transaction writes to YNAB immediately. No "flush on quit" batch.

For each mutating keystroke:
1. **Optimistic local update:** update SQLite row, advance to next transaction in TUI.
2. **Insert `inflight_writes` row** with change details.
3. **Fire async API call** (`updateTransaction` — single-transaction endpoint).
4. **On success:** delete `inflight_writes` row. Show brief ✓ indicator in UI.
5. **On failure:**
   - Roll back the local change (restore previous row state — keep a copy in the inflight payload).
   - Show non-blocking error banner: `Sync failed for TARGET #1847: <error>. Press r to retry, i to ignore.`
   - Leave `inflight_writes` row in place until user resolves.

Do not block input on the API call. Ink's async model makes it easy to fire-and-track: user can keep blasting through transactions while the previous write lands. Maintain a small in-memory map of in-flight writes keyed by transaction id to prevent racing writes against the same row.

**Startup replay:** on launch, if `inflight_writes` is non-empty, prompt: `N writes from prior session did not confirm. Retry? [y/N]`. Retries are idempotent — YNAB's PATCH endpoints accept the same state repeatedly.

## Startup flow
1. Load config.
2. Check `inflight_writes` — if non-empty, prompt for retry.
3. Sync from YNAB.
4. Load queue: all rows where `approved = 0 AND deleted = 0`, sorted by config (default: date desc).
5. Enter ink TUI.

## TUI — ink component structure

```
<App>
  ├─ <Header />              counts, sync status, online/offline indicator
  ├─ <TransactionView />     main screen, swaps children based on mode
  │    ├─ <DefaultMode />    shows current transaction + history + keybinds
  │    ├─ <CategoryPicker /> invoked by 'c' — wraps ink-select-input
  │    └─ <MemoEditor />     invoked by 'm' — wraps ink-text-input
  ├─ <ErrorBanner />         non-blocking, dismissable, stacks
  └─ <Footer />              keybind legend
```

State (use `useReducer` at App level — single source of truth):
- `queue: Transaction[]` — remaining unapproved
- `index: number` — current position
- `mode: 'default' | 'picker' | 'memo'`
- `inflight: Map<txId, WriteState>` — for optimistic UI + retry
- `errors: Error[]`
- `history: Action[]` — for undo

## TUI — default mode screen layout

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
  [u] undo last                [q] quit
                                                      ✓ saved
```

Payee with no history shows: `History: (no prior approvals for this payee)` and no suggestion — user must press `c`.

The `✓ saved` / `⏳ saving` / `✗ failed` indicator lives in the bottom-right corner and reflects the most recent write's status.

## Category picker (invoked by `c`)
- Wraps `ink-select-input` with a text input filter on top
- Fuzzy-match substring filter (case-insensitive) across `categories.name`
- Up/down arrows to cycle
- Enter to select → immediately writes (no separate confirm)
- Esc to cancel back to default mode
- Hidden categories excluded by default; flag to include

## Keybindings (default mode)

| Key | Action | Writes to YNAB? |
|---|---|---|
| `y` / enter | Approve with suggested category | Yes |
| `c` | Open category picker | Yes (on pick) |
| `n` | Advance without change | No |
| `s` | Skip (remains unapproved, not flagged) | No |
| `x` | Flag for split (sets `flag_color=purple`, advances, no approval) | Yes |
| `m` | Edit memo inline | Yes (on enter) |
| `u` | Undo last change (reverts locally + pushes revert to YNAB) | Yes |
| `q` | Quit | No (confirms if `inflight_writes` non-empty) |

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
ynab-blaster status            # show counts: unapproved, inflight writes
ynab-blaster retry-inflight    # force-retry any inflight_writes
```

## Error handling
- **401**: PAT expired or revoked. Print clear message, point to `init`.
- **429**: exponential backoff per request. YNAB allows 200 req/hour per token. With per-approval writes, a 40-transaction session = ~40 calls, well under the cap.
- **Network failure mid-sync**: abort sync, keep stale local data, warn user, offer to continue with stale queue.
- **Network failure on a single write**: see write path — inflight row persists, UI shows error, user can retry.
- **Malformed config**: specific error pointing to the offending key.

## Testing expectations
- Unit tests for: category picker fuzzy match, payee history aggregation, milliunit formatting, reducer state transitions.
- Integration test against a dedicated test budget covering sync → approve → write-confirm cycle, plus simulated network failure → inflight replay. Hide behind `YNAB_TEST_BUDGET_ID` env var.
- No mocking the YNAB API in integration tests — use a real test budget.
- Ink components: use `ink-testing-library` for snapshot tests of key screens.

## Open questions to resolve during implementation
1. When a transaction has `payee_id = null` but a `payee_name` string (imported matched payee not yet resolved), match history by name fallback or treat as no-history? **Suggested:** fallback to name exact-match.
2. Transfer transactions appear as unapproved in both accounts — suppress one side or show both? **Suggested:** show both; let user approve each; YNAB dedupes category logic on its side.
3. How to visually distinguish inflows (positive amounts)? **Suggested:** green amount, and skip "approve as <category>" suggestion for inflows (YNAB income category handling is separate).

---

## v2+ vision — roadmap for placeholder GitHub issues

The coding agent should open one issue per item below, labeled `v2`, with the description text as written. Titles are agent-writable but should match the item heading. All are explicitly out of scope for v1.

### Issue: Rules engine for pre-categorization

Add a YAML-driven rules layer that runs before the manual approval loop. Rules pre-populate category selections, flag transactions for review, or (with explicit opt-in per rule) auto-approve silently.

Rules file at `~/.config/ynab-blaster/rules.yml`. First-match-wins by file order — no priority numbers, no conflict resolver. Deliberate choice for debuggability when real money is involved.

Example shape:

```yaml
rules:
  - name: Spotify
    match: { payee: "Spotify" }
    set: { category: "Subscriptions" }
    auto_approve: true

  - name: Amazon small
    match: { payee_contains: "Amazon", amount_abs_lt: 20 }
    set: { category: "Household" }
    # pre-fills, still requires 'y' to approve

  - name: Amazon big
    match: { payee_contains: "Amazon", amount_abs_gt: 100 }
    action: flag
    reason: "Probably needs a split"
```

After running rules, the TUI shows three buckets at session start: auto-approved (count only, no interaction), pre-filled (walk through normally, category pre-selected), unmatched (walk through, no suggestion beyond history).

Dependencies: robust YAML schema validator with clear error messages pointing to file+line.

### Issue: Confidence-gated auto-approve

Extend the history-based suggestion system to auto-approve transactions where the dominant category exceeds a configurable confidence threshold (default: 95% across ≥20 observations for that payee).

Config keys: `auto_approve.enabled`, `auto_approve.min_confidence`, `auto_approve.min_observations`, `auto_approve.max_amount` (safety cap).

Auto-approved transactions still appear in a `ynab-blaster review-auto` command that shows the last N auto-approvals for audit.

This is higher-risk than the rules engine because decisions are implicit. Requires careful UI around "what did the app do last session" so the user doesn't lose visibility.

### Issue: Split editor with pre-populated defaults

When a rule or user shortcut specifies a split (e.g., "Target → 70% Groceries / 30% Household"), open an inline split editor pre-populated with those allocations. User tweaks percentages or dollar amounts, hits enter, app submits the split via YNAB's sub-transaction API.

Ink component: table-style editor with each row editable, running total updates live, cannot submit until sum matches transaction amount.

Replaces the current `[x] flag for split` keybind, which will remain as an alternate path.

### Issue: Payee fuzzy grouping

YNAB creates separate payees for STARBUCKS #2345 and STARBUCKS #6789. Treat them as one merchant for history purposes.

Approach: add a `payee_groups` table mapping raw payee IDs to a canonical group name. Populate via:
1. Automatic clustering on payee-name prefix similarity (levenshtein or token-based).
2. Manual grouping command: `ynab-blaster group merge "STARBUCKS*"`.

History lookups use group when available, fall back to raw payee.

### Issue: Learning prompt for emergent rules

After the user manually applies the same (payee → category) mapping N consecutive times with no matching rule, offer:

```
You've categorized STARBUCKS as Eating Out 5 times in a row.
Create a rule? [y]es / [N]o / [c]ustom
```

`y` appends a simple rule to `rules.yml`. `c` opens `$EDITOR` on `rules.yml` scrolled to a template stub. `N` dismisses and waits for the next 5.

Requires rules engine (first v2 issue) to ship first.

### Issue: Multi-budget support

Allow the config to declare multiple budgets and switch between them at startup or via CLI flag.

```yaml
budgets:
  personal: <uuid>
  business: <uuid>
default: personal
```

`ynab-blaster --budget business`. Each budget gets its own SQLite file.

### Issue: Inflow / income handling polish

Positive-amount transactions (income) have different categorization semantics in YNAB. Current v1 spec skips the default "approve as X" suggestion for inflows but otherwise treats them uniformly.

Extend to: detect inflows, route to an income-specific category list (typically "Ready to Assign" or user-configured income categories), and show a different suggestion panel.

### Issue: Transfer handling

Transfers appear as two unapproved transactions (one per account). v1 shows both; user approves each independently.

v2: detect transfer pairs, show as a single UI entry, approve both sides in one keystroke. Requires matching on amount + date + transfer_account_id from YNAB's API.

### Issue: Session summary on quit

On `q`, print a summary:

```
Session summary:
  47 unapproved at start
  38 approved (12 Groceries, 9 Eating Out, 8 Household, ...)
  4 flagged for split
  5 skipped
  Time elapsed: 1m 47s
```

Useful for the ADHD "did I actually do the thing" feedback loop.

### Issue: Export approval history to JSON

`ynab-blaster export --since 2026-01-01 > history.json`

For downstream analysis, backups, or feeding into learning-prompt heuristics.
