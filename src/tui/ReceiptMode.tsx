import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { formatMilliunits } from '../format.js';
import type { TransactionRow } from '../db/transactions.js';
import type { ReceiptState } from './reducer.js';
import type { ReceiptSuggestion, SuggestionReason } from '../receipt/types.js';

interface Props {
  state: ReceiptState;
  transaction: TransactionRow;
}

const MAX_ITEMS_SHOWN = 6;

function reasonText(reason: SuggestionReason): string {
  if (reason.kind === 'payee_history') {
    return `payee history: ${reason.pct}% over ${reason.count}`;
  }
  if (reason.kind === 'keyword') {
    return `keyword "${reason.keyword}"`;
  }
  return 'no signal — pick a category';
}

function MatchTag({ status, label }: { status: 'matches' | 'differs' | 'unknown'; label: string }) {
  if (status === 'matches') return <Text color="green">  ✓ {label}</Text>;
  if (status === 'differs') return <Text color="red">  ✗ {label}</Text>;
  return <Text dimColor>  ? {label}</Text>;
}

function ReviewPanel({ state, transaction }: Props) {
  const { parsed, suggestion } = state;
  if (!parsed || !suggestion) return null;

  const detectedTotal =
    parsed.total_milliunits !== null ? formatMilliunits(parsed.total_milliunits) : '(not detected)';
  const txAmount = formatMilliunits(transaction.amount);

  return (
    <Box flexDirection="column">
      <Text bold>Receipt scanned ─────────────────────────────────────</Text>

      <Box>
        <Text>  Merchant:  </Text>
        <Text bold>{parsed.merchant ?? '(not detected)'}</Text>
        <MatchTag status={suggestion.merchant_match} label={merchantLabel(suggestion.merchant_match, transaction.payee_name)} />
      </Box>

      <Box>
        <Text>  Date:      </Text>
        <Text bold>{parsed.date ?? '(not detected)'}</Text>
        <MatchTag status={suggestion.date_match} label={dateLabel(suggestion.date_match, transaction.date)} />
      </Box>

      <Box>
        <Text>  Total:     </Text>
        <Text bold>{detectedTotal}</Text>
        {parsed.total_milliunits !== null ? (
          suggestion.total_mismatch ? (
            <Text color="red">  ✗ off by {formatMilliunits(Math.abs(suggestion.total_diff_milliunits))} vs tx {txAmount}</Text>
          ) : (
            <Text color="green">  ✓ matches tx {txAmount}</Text>
          )
        ) : (
          <Text dimColor>  ? tx {txAmount}</Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>  Items:</Text>
        {parsed.items.length === 0 ? (
          <Text dimColor>    (none parsed)</Text>
        ) : (
          <>
            {parsed.items.slice(0, MAX_ITEMS_SHOWN).map((it, i) => (
              <Text key={i}>
                {'    - '}
                {it.description.padEnd(28).slice(0, 28)}
                {' '}
                <Text dimColor>{formatMilliunits(it.amount_milliunits)}</Text>
              </Text>
            ))}
            {parsed.items.length > MAX_ITEMS_SHOWN && (
              <Text dimColor>{`    … ${parsed.items.length - MAX_ITEMS_SHOWN} more`}</Text>
            )}
          </>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {suggestion.category_name ? (
          <Text>
            Suggested: <Text bold color="cyan">{suggestion.category_name}</Text>
            <Text dimColor>{`  (${reasonText(suggestion.reason)})`}</Text>
          </Text>
        ) : (
          <Text dimColor>No suggestion — press [c] to choose a category</Text>
        )}
      </Box>

      <Box marginTop={1}>
        {suggestion.category_name ? (
          <Text>[y] approve as <Text bold>{suggestion.category_name}</Text>   [c] change category   [esc] discard</Text>
        ) : (
          <Text>[c] choose category   [esc] discard</Text>
        )}
      </Box>
    </Box>
  );
}

function merchantLabel(status: 'matches' | 'differs' | 'unknown', payee: string | null): string {
  if (status === 'matches') return `matches payee${payee ? ` (${payee})` : ''}`;
  if (status === 'differs') return `differs from payee${payee ? ` (${payee})` : ''}`;
  return payee ? `payee: ${payee}` : 'no payee on tx';
}

function dateLabel(status: 'matches' | 'differs' | 'unknown', txDate: string): string {
  if (status === 'matches') return `matches tx (${txDate})`;
  if (status === 'differs') return `differs from tx (${txDate})`;
  return `tx: ${txDate}`;
}

function StageLine({ stage }: { stage: ReceiptState['stage'] }) {
  const map: Record<ReceiptState['stage'], string> = {
    capturing: 'Waiting for receipt capture in Shortcuts…',
    ocr: 'Running OCR…',
    analyzing: 'Analyzing receipt…',
    review: '',
    error: '',
  };
  if (!map[stage]) return null;
  return (
    <Box>
      <Text color="yellow"><Spinner type="dots" /></Text>
      <Text>{` ${map[stage]}`}</Text>
    </Box>
  );
}

// Top-level mode component. Switches between progress, review, and error UIs
// based on `state.stage`. All keybinds are owned by App.tsx — this component
// is purely presentational.
export function ReceiptMode({ state, transaction }: Props) {
  if (state.stage === 'error') {
    return (
      <Box flexDirection="column">
        <Text bold color="red">Receipt scan failed</Text>
        <Text>  {state.error ?? 'unknown error'}</Text>
        <Box marginTop={1}><Text>[r] retry   [esc] cancel</Text></Box>
      </Box>
    );
  }

  if (state.stage === 'review') {
    return <ReviewPanel state={state} transaction={transaction} />;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Receipt scan in progress</Text>
      <Box marginTop={1}><StageLine stage={state.stage} /></Box>
      <Box marginTop={1}><Text dimColor>[esc] cancel</Text></Box>
    </Box>
  );
}
