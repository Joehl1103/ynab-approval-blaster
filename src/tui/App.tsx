import React, { useReducer, useEffect } from 'react';
import { unlink } from 'fs/promises';
import { Box, Text, useInput, useApp } from 'ink';
import type Database from 'better-sqlite3';
import type * as ynab from 'ynab';
import type { Config } from '../config.js';
import { reducer, initialState } from './reducer.js';
import { Header } from './Header.js';
import { Footer } from './Footer.js';
import { DefaultMode } from './DefaultMode.js';
import { CategoryPicker } from './CategoryPicker.js';
import { MemoEditor } from './MemoEditor.js';
import { ReceiptMode } from './ReceiptMode.js';
import { ErrorBanner } from './ErrorBanner.js';
import { WriteStatus } from './WriteStatus.js';
import { WriteManager } from '../write-manager.js';
import { getUnapprovedTransactions } from '../db/transactions.js';
import { getCategories, getCategoriesGrouped, type CategoryRow } from '../db/categories.js';
import { getPayeeHistory } from '../db/history.js';
import { captureReceipt } from '../receipt/capture.js';
import { runOcr } from '../receipt/ocr.js';
import { parseReceipt } from '../receipt/parse.js';
import { suggestFromReceipt } from '../receipt/suggest.js';

// Hardcoded name of the YNAB category used by the `w` keybind to mark a
// transaction as having an unknown / to-be-reviewed category. Resolved once
// at startup in run.ts; missing-category causes the app to exit before the
// TUI mounts.
export const WRONG_CATEGORY_NAME = '\u{1F4B5} Wrong Category';

interface Props {
  db: Database.Database;
  api: ynab.API;
  config: Config;
  wrongCategory: CategoryRow;
}

// Root App component. Owns all state via useReducer.
// Wires WriteManager calls to keybindings and dispatches state transitions.
export function App({ db, api, config, wrongCategory }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { exit } = useApp();

  const manager = new WriteManager(db, api, config.budget_id);
  const categories = getCategories(db, config.include_hidden_categories);
  const categoryGroups = getCategoriesGrouped(db, config.include_hidden_categories);

  // Load unapproved queue on mount.
  useEffect(() => {
    const queue = getUnapprovedTransactions(db, config.sort);
    dispatch({ type: 'LOAD_QUEUE', queue });
  }, []);

  const currentTx = state.queue[state.index];
  const payeeHistory = currentTx ? getPayeeHistory(db, currentTx.payee_id ?? '') : [];

  const suggestedCategory =
    payeeHistory.length > 0
      ? categories.find((c) => c.id === payeeHistory[0].category_id) ?? null
      : null;

  // Fires a write, updates optimistic UI, and handles errors.
  const fireWrite = async (writeFn: () => Promise<void>) => {
    dispatch({ type: 'SET_WRITE_STATUS', status: 'saving' });
    try {
      if (currentTx) {
        dispatch({ type: 'PUSH_HISTORY', snapshot: { ...currentTx } });
      }
      await writeFn();
      dispatch({ type: 'SET_WRITE_STATUS', status: 'saved' });
      dispatch({ type: 'NEXT' });
    } catch (err) {
      dispatch({ type: 'SET_WRITE_STATUS', status: 'failed' });
      dispatch({ type: 'ADD_ERROR', error: (err as Error).message });
    }
  };

  // Drives the capture -> OCR -> parse -> suggest pipeline. Each stage emits
  // a progress dispatch so the TUI shows the right spinner. Temp image is
  // unlinked best-effort regardless of outcome — we don't persist anything.
  const fireReceiptScan = async () => {
    if (!currentTx || !config.receipt) return;
    dispatch({ type: 'RECEIPT_START' });
    let imagePath: string | null = null;
    try {
      imagePath = await captureReceipt({
        shortcutName: config.receipt.shortcut_name,
        tempDir: config.receipt.temp_dir,
      });
      dispatch({ type: 'RECEIPT_PROGRESS', stage: 'ocr' });
      const lines = await runOcr(imagePath);
      dispatch({ type: 'RECEIPT_PROGRESS', stage: 'analyzing' });
      const parsed = parseReceipt(lines);
      const suggestion = suggestFromReceipt({
        parsed,
        transaction: currentTx,
        categories,
        history: payeeHistory,
        keywordMap: config.receipt.keyword_map,
      });
      dispatch({ type: 'RECEIPT_RESULT', parsed, suggestion });
    } catch (err) {
      dispatch({ type: 'RECEIPT_FAIL', error: (err as Error).message });
    } finally {
      if (imagePath) {
        unlink(imagePath).catch(() => {
          // Discarded by design — log nothing, leak nothing.
        });
      }
    }
  };

  useInput((input, key) => {
    if (state.mode === 'receipt') {
      if (key.escape) {
        dispatch({ type: 'RECEIPT_CLOSE' });
        return;
      }
      if (state.receipt?.stage === 'review') {
        if (!currentTx) return;
        const sug = state.receipt.suggestion;
        if ((input === 'y' || key.return) && sug?.category_id) {
          dispatch({ type: 'RECEIPT_CLOSE' });
          fireWrite(() => manager.approve(currentTx.id, sug.category_id!));
        }
        if (input === 'c') dispatch({ type: 'SET_MODE', mode: 'picker' });
      }
      if (state.receipt?.stage === 'error' && input === 'r') {
        fireReceiptScan();
      }
      return;
    }

    if (state.mode !== 'default') return;

    if (input === 'q') exit();
    if (input === 'd') dispatch({ type: 'DISMISS_ERROR' });

    if (!currentTx) return;

    if ((input === 'y' || key.return) && suggestedCategory && currentTx.amount <= 0) {
      fireWrite(() => manager.approve(currentTx.id, suggestedCategory.id));
    }
    if (input === 'c') dispatch({ type: 'SET_MODE', mode: 'picker' });
    if (input === 'n') dispatch({ type: 'NEXT' });
    if (input === 's') dispatch({ type: 'NEXT' });
    if (input === 'w') fireWrite(() => manager.approve(currentTx.id, wrongCategory.id));
    if (input === 'x') fireWrite(() => manager.flagForSplit(currentTx.id));
    if (input === 'm') dispatch({ type: 'SET_MODE', mode: 'memo' });
    if (input === 'r' && config.receipt?.enabled) fireReceiptScan();
    if (input === 'u' && state.history.length > 0) dispatch({ type: 'POP_HISTORY' });
  });

  const handleCategorySelect = (categoryId: string, categoryName: string) => {
    if (!currentTx) return;
    if (state.receipt) dispatch({ type: 'RECEIPT_CLOSE' });
    dispatch({ type: 'SET_MODE', mode: 'default' });
    fireWrite(() => manager.approve(currentTx.id, categoryId));
  };

  const handleMemoSubmit = (memo: string) => {
    if (!currentTx) return;
    dispatch({ type: 'SET_MODE', mode: 'default' });
    fireWrite(() => manager.editMemo(currentTx.id, memo));
  };

  if (state.queue.length === 0) {
    return <Box><Text>No unapproved transactions. You're all caught up.</Text></Box>;
  }

  if (!currentTx) {
    return <Box><Text>Queue complete.</Text></Box>;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header current={state.index + 1} total={state.queue.length} syncing={false} />

      <ErrorBanner
        errors={state.errors}
        onDismiss={() => dispatch({ type: 'DISMISS_ERROR' })}
      />

      {state.mode === 'default' && (
        <DefaultMode
          transaction={currentTx}
          history={payeeHistory}
          categories={categories}
          suggestedCategoryName={suggestedCategory?.name ?? null}
          writeStatus={state.writeStatus}
        />
      )}

      {state.mode === 'picker' && (
        <CategoryPicker
          groups={categoryGroups}
          onSelect={handleCategorySelect}
          onCancel={() => {
            if (state.receipt) {
              dispatch({ type: 'SET_MODE', mode: 'receipt' });
            } else {
              dispatch({ type: 'SET_MODE', mode: 'default' });
            }
          }}
        />
      )}

      {state.mode === 'memo' && (
        <MemoEditor
          initialMemo={currentTx.memo ?? ''}
          onSubmit={handleMemoSubmit}
          onCancel={() => dispatch({ type: 'SET_MODE', mode: 'default' })}
        />
      )}

      {state.mode === 'receipt' && state.receipt && (
        <ReceiptMode state={state.receipt} transaction={currentTx} />
      )}

      <Box justifyContent="space-between">
        <Footer />
        <WriteStatus status={state.writeStatus} />
      </Box>
    </Box>
  );
}
