# YNAB Blaster

Rip through YNAB unapproved transactions with single keystrokes.

## Overview

YNAB Blaster is a terminal CLI tool that lets you rapidly approve, recategorize, and skip YNAB transactions without leaving the keyboard. It syncs your budget locally into SQLite and provides a fast keyboard-driven interface for processing your unapproved queue.

## Features (v0.1 — Foundation)

- **`init`** — Interactive first-time setup: enter your YNAB Personal Access Token, pick a budget, and write `config.yml`
- **`sync`** — Fetches transactions, categories, and payees from YNAB into a local SQLite database with delta sync (only fetches changes after the first run)
- **`status`** — Prints unapproved transaction count, inflight writes, and last sync time

## Tech Stack

- Node.js 20+, TypeScript
- [`ynab`](https://github.com/ynab/ynab-sdk-js) SDK for API access
- [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) for synchronous SQLite
- [`commander`](https://github.com/tj/commander.js) for CLI subcommands
- [`vitest`](https://vitest.dev) for unit tests

## Installation

```bash
npm install
npm run build
npm link   # makes `ynab-blaster` available globally
```

## Usage

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
  commands/
    init.ts           # ynab-blaster init
    sync.ts           # ynab-blaster sync
    status.ts         # ynab-blaster status
  db/
    client.ts         # Open SQLite database
    schema.ts         # Idempotent table + index creation
    meta.ts           # Key-value meta store
    categories.ts     # Category upsert + query
    payees.ts         # Payee upsert
    transactions.ts   # Transaction upsert + unapproved queue
    history.ts        # Payee→category history aggregation
tests/
  config.test.ts      # Config validation tests
  format.test.ts      # Milliunit formatter tests
  history.test.ts     # History aggregation tests
```

## Development

```bash
npm run dev        # Run CLI via tsx (no build step)
npm test           # Run unit tests
npm run build      # Compile TypeScript to dist/
```
