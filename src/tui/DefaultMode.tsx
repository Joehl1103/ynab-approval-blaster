import React from 'react';
import { Box, Text } from 'ink';
import { formatMilliunits } from '../format.js';
import type { TransactionRow } from '../db/transactions.js';
import type { HistoryRow } from '../db/history.js';
import type { CategoryRow } from '../db/categories.js';
import type { WriteStatus } from './reducer.js';

interface Props {
  transaction: TransactionRow;
  history: HistoryRow[];
  categories: CategoryRow[];
  suggestedCategoryName: string | null;
  writeStatus: WriteStatus;
}

// Main transaction view shown in default mode.
// Displays transaction details, payee history, suggested category, and keybind hints.
export function DefaultMode({ transaction, history, categories, suggestedCategoryName, writeStatus }: Props) {
  const amount = formatMilliunits(transaction.amount);
  const isInflow = transaction.amount > 0;
  const totalHistory = history.reduce((sum, h) => sum + h.count, 0);
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>{transaction.date}  </Text>
        <Text bold>{transaction.payee_name ?? '(unknown payee)'}  </Text>
        <Text bold color={isInflow ? 'green' : 'red'}>{amount}  </Text>
        <Text dimColor>{transaction.account_name ?? ''}</Text>
      </Box>

      <Text dimColor>Memo: {transaction.memo ?? '(none)'}</Text>

      <Box flexDirection="column" marginY={1}>
        {history.length > 0 ? (
          <>
            <Text bold>History for {transaction.payee_name}:</Text>
            {history.map((h) => {
              const pct = Math.round((h.count / totalHistory) * 100);
              return (
                <Text key={h.category_id}>
                  {'  '}{categoryName(h.category_id).padEnd(30)} {String(pct).padStart(3)}%  ({h.count})
                </Text>
              );
            })}
          </>
        ) : (
          <Text dimColor>History: (no prior approvals for this payee)</Text>
        )}
      </Box>

      {suggestedCategoryName && !isInflow && (
        <Text>Suggested: <Text bold color="cyan">{suggestedCategoryName}</Text></Text>
      )}

      <Box marginTop={1} justifyContent="space-between">
        <Box flexDirection="column">
          {suggestedCategoryName && !isInflow ? (
            <Text>[y/↵] approve as <Text bold>{suggestedCategoryName}</Text></Text>
          ) : (
            <Text dimColor>[y/↵] approve (pick category first)</Text>
          )}
          <Text>[n] next (no change)</Text>
          <Text>[x] flag for split</Text>
          <Text>[u] undo last</Text>
        </Box>
        <Box flexDirection="column">
          <Text>[c] change category</Text>
          <Text>[s] skip</Text>
          <Text>[m] edit memo</Text>
          <Text>[q] quit</Text>
        </Box>
      </Box>
    </Box>
  );
}
