import React, { useReducer, useEffect } from 'react';
import { Box, useInput, useApp } from 'ink';
import type Database from 'better-sqlite3';
import type * as ynab from 'ynab';
import type { Config } from '../config.js';
import { reducer, initialState } from './reducer.js';
import { Header } from './Header.js';
import { Footer } from './Footer.js';
import { DefaultMode } from './DefaultMode.js';
import { CategoryPicker } from './CategoryPicker.js';
import { MemoEditor } from './MemoEditor.js';
import { ErrorBanner } from './ErrorBanner.js';
import { WriteStatus } from './WriteStatus.js';
import { WriteManager } from '../write-manager.js';
import { getUnapprovedTransactions } from '../db/transactions.js';
import { getCategories } from '../db/categories.js';
import { getPayeeHistory } from '../db/history.js';

interface Props {
  db: Database.Database;
  api: ynab.API;
  config: Config;
}

// Root App component. Owns all state via useReducer.
// Wires WriteManager calls to keybindings and dispatches state transitions.
export function App({ db, api, config }: Props) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { exit } = useApp();

  const manager = new WriteManager(db, api, config.budget_id);
  const categories = getCategories(db, config.include_hidden_categories);

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

  useInput((input, key) => {
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
    if (input === 'x') fireWrite(() => manager.flagForSplit(currentTx.id));
    if (input === 'm') dispatch({ type: 'SET_MODE', mode: 'memo' });
    if (input === 'u' && state.history.length > 0) dispatch({ type: 'POP_HISTORY' });
  });

  const handleCategorySelect = (categoryId: string, categoryName: string) => {
    if (!currentTx) return;
    dispatch({ type: 'SET_MODE', mode: 'default' });
    fireWrite(() => manager.approve(currentTx.id, categoryId));
  };

  const handleMemoSubmit = (memo: string) => {
    if (!currentTx) return;
    dispatch({ type: 'SET_MODE', mode: 'default' });
    fireWrite(() => manager.editMemo(currentTx.id, memo));
  };

  if (state.queue.length === 0) {
    return <Box><Box>No unapproved transactions. You're all caught up.</Box></Box>;
  }

  if (!currentTx) {
    return <Box><Box>Queue complete.</Box></Box>;
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
          suggestedCategoryName={suggestedCategory?.name ?? null}
          writeStatus={state.writeStatus}
        />
      )}

      {state.mode === 'picker' && (
        <CategoryPicker
          categories={categories}
          onSelect={handleCategorySelect}
          onCancel={() => dispatch({ type: 'SET_MODE', mode: 'default' })}
        />
      )}

      {state.mode === 'memo' && (
        <MemoEditor
          initialMemo={currentTx.memo ?? ''}
          onSubmit={handleMemoSubmit}
          onCancel={() => dispatch({ type: 'SET_MODE', mode: 'default' })}
        />
      )}

      <Box justifyContent="space-between">
        <Footer />
        <WriteStatus status={state.writeStatus} />
      </Box>
    </Box>
  );
}
