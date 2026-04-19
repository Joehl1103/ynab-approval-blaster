# YNAB Blaster

Rip through YNAB unapproved transactions with single keystrokes.

## Overview

YNAB Blaster is a terminal CLI tool that lets you rapidly approve, recategorize, and skip YNAB transactions without leaving the keyboard. It syncs your budget locally into SQLite and provides a fast keyboard-driven interface for processing your unapproved queue.

## Features (v0.1 — Foundation + Write Path + TUI)

- **`ynab-blaster`** (no subcommand) — Syncs from YNAB and launches the full Ink terminal UI
- **`init`** — Interactive first-time setup: enter your YNAB Personal Access Token, pick a budget, and write `config.yml`
- **`sync`** — Fetches transactions, categories, and payees from YNAB into a local SQLite database with delta sync (only fetches changes after the first run)
- **`status`** — Prints unapproved transaction count, inflight writes, and last sync time
- **`retry-inflight`** — Force-retries any writes that didn't confirm in a previous session (crash recovery)
- **Write path with crash safety** — Every write (approve, recategorize, memo, flag) is journaled in `inflight_writes` before the API call. On failure, the local change is rolled back; on crash, the journal survives and can be replayed at startup or via `retry-inflight`

### TUI Keybindings

| Key | Action |
|-----|--------|
| `y` / Enter | Approve with suggested category |
| `c` | Open category picker (fuzzy filter) |
| `n` | Next transaction (no change) |
| `s` | Skip |
| `x` | Flag for split |
| `m` | Edit memo |
| `u` | Undo last action |
| `q` | Quit |
| `d` | Dismiss error banner |

## Tech Stack

- Node.js 20+, TypeScript
- [`ink`](https://github.com/vadimdemedes/ink) for the React-based terminal UI
- [`ynab`](https://github.com/ynab/ynab-sdk-js) SDK for API access
- [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) for synchronous SQLite
- [`commander`](https://github.com/tj/commander.js) for CLI subcommands
- [`vitest`](https://vitest.dev) + [`ink-testing-library`](https://github.com/vadimdemedes/ink-testing-library) for unit and TUI tests

## Installation

```bash
npm install
npm run build
npm link   # makes `ynab-blaster` available globally
```

## Usage

### Run the TUI (default)

```bash
ynab-blaster
```

Syncs latest data from YNAB, checks for unconfirmed writes from any prior session, then launches the interactive approval TUI.

### First-time setup

```bash
ynab-blaster init
```

Walks you through entering your [YNAB Personal Access Token](https://app.ynab.com/settings/developer) and selecting a budget. Writes config to `~/.config/ynab-blaster/config.yml`.

### Sync from YNAB

```bash
ynab-blaster sync
```

Fetches all transactions, categories, and payees from YNAB and stores them locally. Subsequent syncs use delta sync (`server_knowledge`) to fetch only changes.

### Check status

```bash
ynab-blaster status
```

Prints the number of unapproved transactions, pending inflight writes, and the last sync timestamp.

### Retry inflight writes

```bash
ynab-blaster retry-inflight
```

Replays any writes that survived a crash or network failure from a previous session. Safe to run any time — YNAB accepts duplicate PATCHes idempotently.

## Configuration

Config is stored at `~/.config/ynab-blaster/config.yml`:

```yaml
personal_access_token: your-pat-here
budget_id: your-budget-uuid
db_path: ~/.local/share/ynab-blaster/ynab.db
include_hidden_categories: false
sort: date_desc  # date_desc | date_asc | account
```

## Architecture

```
src/
  cli.ts              # Commander entry point
  config.ts           # Load + validate config.yml
  sync.ts             # YNAB delta sync orchestrator
  ynab.ts             # YNAB API client factory
  format.ts           # Milliunit → dollar string formatter
  fuzzy.ts            # Case-insensitive substring filter for category picker
  write-manager.ts    # Write lifecycle: optimistic update → API call → confirm/rollback
  replay.ts           # Startup replay of surviving inflight_writes rows
  commands/
    init.ts           # ynab-blaster init
    run.ts            # ynab-blaster (default) — syncs + mounts TUI
    sync.ts           # ynab-blaster sync
    status.ts         # ynab-blaster status
    retry-inflight.ts # ynab-blaster retry-inflight
  db/
    client.ts         # Open SQLite database
    schema.ts         # Idempotent table + index creation
    meta.ts           # Key-value meta store
    categories.ts     # Category upsert + query
    payees.ts         # Payee upsert
    transactions.ts   # Transaction upsert + unapproved queue
    history.ts        # Payee→category history aggregation
    inflight.ts       # Insert, delete, and list inflight_writes rows
  tui/
    reducer.ts        # useReducer state shape, action types, pure reducer
    App.tsx           # Root component: loads queue, wires keybindings, mounts children
    Header.tsx        # Queue position and sync status
    Footer.tsx        # Keybind legend
    DefaultMode.tsx   # Main transaction view: payee history, suggestion, hints
    CategoryPicker.tsx # Fuzzy-filter category selector
    MemoEditor.tsx    # Inline memo editor
    ErrorBanner.tsx   # Dismissable error stack
    WriteStatus.tsx   # Bottom-right ✓/⏳/✗ write indicator
tests/
  config.test.ts          # Config validation tests
  format.test.ts          # Milliunit formatter tests
  fuzzy.test.ts           # Fuzzy filter tests
  history.test.ts         # History aggregation tests
  inflight.test.ts        # Inflight DB helper tests
  reducer.test.ts         # Reducer state transition tests
  tui-snapshots.test.tsx  # ink-testing-library TUI component tests
  write-manager.test.ts   # WriteManager state transition tests
```

## Development

```bash
npm run dev        # Run CLI via tsx (no build step)
npm test           # Run unit tests
npm run build      # Compile TypeScript to dist/
```
