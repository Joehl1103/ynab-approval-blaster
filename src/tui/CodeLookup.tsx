import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type Database from 'better-sqlite3';
import {
  exactLookup,
  partialLookup,
  upsertReceiptCode,
  type ReceiptCodeRow,
} from '../db/codes.js';
import { CategoryPicker } from './CategoryPicker.js';
import type { CategoryGroup } from '../db/categories.js';
import { guessReceiptCode, type LlmGuess } from '../llm.js';

// ---------- Phase type ----------

type Phase =
  | 'store-prompt'    // no payee on tx — ask user for store name
  | 'code-input'      // user types the receipt code to look up
  | 'exact-match'     // single exact result found
  | 'partial-match'   // list of fuzzy results shown
  | 'miss'            // no match — choose: manual entry or ask LLM
  | 'manual-desc'     // user types description for new entry
  | 'manual-category' // user picks category via CategoryPicker
  | 'llm-loading'     // waiting for LLM response
  | 'llm-confirm'     // LLM returned a guess — show and ask user to confirm or discard
  | 'llm-category';   // user picks category after accepting LLM description

// ---------- Props ----------

interface Props {
  db: Database.Database;
  // The payee name from the current transaction; null when no payee is set.
  payeeName: string | null;
  categoryGroups: CategoryGroup[];
  // Optional API key; when absent the LLM fallback is unavailable.
  anthropicApiKey: string | undefined;
  // Called when the user chooses to apply a looked-up code's category to the current tx.
  onApplyCategory: (categoryId: string, categoryName: string) => void;
  onClose: () => void;
}

// ---------- Component ----------

export function CodeLookup({
  db,
  payeeName,
  categoryGroups,
  anthropicApiKey,
  onApplyCategory,
  onClose,
}: Props) {
  // Resolved store name (from payee or manual prompt).
  const [storeName, setStoreName] = useState<string>(payeeName ?? '');
  const [storeInput, setStoreInput] = useState('');

  const [codeInput, setCodeInput] = useState('');

  // Current phase of the lookup flow.
  const [phase, setPhase] = useState<Phase>(payeeName ? 'code-input' : 'store-prompt');

  // Results state.
  const [exactRow, setExactRow] = useState<ReceiptCodeRow | null>(null);
  const [partialRows, setPartialRows] = useState<ReceiptCodeRow[]>([]);
  const [partialCursor, setPartialCursor] = useState(0);

  // Manual-entry state.
  const [manualDesc, setManualDesc] = useState('');
  // Category selected during manual or LLM confirm flow.
  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null);
  const [pendingCategoryName, setPendingCategoryName] = useState<string | null>(null);

  // LLM state.
  const [llmGuess, setLlmGuess] = useState<LlmGuess | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);

  // ---------- useInput: handle navigation keys at each phase ----------

  useInput((input, key) => {
    // Escape always closes the pane and returns to default mode.
    if (key.escape) {
      onClose();
      return;
    }

    switch (phase) {
      case 'store-prompt':
        // TextInput handles typing; Enter handled via onSubmit prop below.
        break;

      case 'code-input':
        // TextInput handles typing; Enter via onSubmit.
        break;

      case 'exact-match':
        if (input === 'a' && exactRow?.suggested_category_id) {
          // Apply saved category directly.
          const cat = categoryGroups.flatMap((g) => g.categories).find(
            (c) => c.id === exactRow.suggested_category_id
          );
          if (cat) {
            upsertReceiptCode(db, storeName, exactRow.code, exactRow.description, cat.id);
            onApplyCategory(cat.id, cat.name);
          } else {
            onClose();
          }
        }
        if (input === 'c') {
          // Apply with category picker (category might not have been saved previously).
          setPhase('manual-category');
        }
        // Any other key closes.
        if (input !== 'a' && input !== 'c' && !key.escape) {
          onClose();
        }
        break;

      case 'partial-match':
        if (key.upArrow) setPartialCursor((c) => Math.max(0, c - 1));
        if (key.downArrow) setPartialCursor((c) => Math.min(partialRows.length - 1, c + 1));
        if (key.return) {
          const row = partialRows[partialCursor];
          if (row) {
            setExactRow(row);
            setPhase('exact-match');
          }
        }
        break;

      case 'miss':
        if (input === 'm') setPhase('manual-desc');
        if (input === 'l' && anthropicApiKey) {
          setPhase('llm-loading');
          triggerLlmGuess();
        }
        break;

      case 'manual-desc':
        // TextInput handles typing; Enter via onSubmit.
        break;

      case 'llm-loading':
        // Nothing to do; waiting for async result.
        break;

      case 'llm-confirm':
        if (input === 'y') {
          // Accept guess description; proceed to category picker.
          setPhase('llm-category');
        }
        if (input === 'n') {
          // Discard LLM result; fall back to manual entry.
          setPhase('manual-desc');
        }
        break;

      case 'manual-category':
      case 'llm-category':
        // CategoryPicker handles input via its own useInput.
        break;
    }
  });

  // ---------- Async helpers ----------

  function triggerLlmGuess() {
    if (!anthropicApiKey) return;
    guessReceiptCode(anthropicApiKey, storeName, codeInput)
      .then((guess) => {
        setLlmGuess(guess);
        setPhase('llm-confirm');
      })
      .catch((err: unknown) => {
        setLlmError(err instanceof Error ? err.message : String(err));
        setPhase('miss');
      });
  }

  // ---------- Submit handlers ----------

  function handleStoreSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setStoreName(trimmed);
    setPhase('code-input');
  }

  function handleCodeSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;

    const exact = exactLookup(db, storeName, trimmed);
    if (exact) {
      setExactRow(exact);
      upsertReceiptCode(db, storeName, trimmed, exact.description, exact.suggested_category_id);
      setPhase('exact-match');
      return;
    }

    const partial = partialLookup(db, storeName, trimmed, 5);
    if (partial.length > 0) {
      setPartialRows(partial);
      setPartialCursor(0);
      setPhase('partial-match');
      return;
    }

    setPhase('miss');
  }

  function handleManualDescSubmit(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setManualDesc(trimmed);
    setPhase('manual-category');
  }

  function handleCategorySelect(categoryId: string, categoryName: string) {
    // Save to the dictionary.
    upsertReceiptCode(db, storeName, codeInput, manualDesc || llmGuess?.description || null, categoryId);
    setPendingCategoryId(categoryId);
    setPendingCategoryName(categoryName);
    // Apply the category to the transaction and close.
    onApplyCategory(categoryId, categoryName);
  }

  // ---------- Render ----------

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">── Receipt Code Lookup (Esc to close) ──</Text>

      {phase === 'store-prompt' && (
        <Box flexDirection="column">
          <Text>No payee on this transaction. Enter a store name for this lookup:</Text>
          <TextInput
            value={storeInput}
            onChange={setStoreInput}
            onSubmit={handleStoreSubmit}
            placeholder="e.g. Ross"
          />
        </Box>
      )}

      {phase === 'code-input' && (
        <Box flexDirection="column">
          <Text>Store: <Text bold>{storeName}</Text></Text>
          <Text>Enter the code from your receipt:</Text>
          <TextInput
            value={codeInput}
            onChange={setCodeInput}
            onSubmit={handleCodeSubmit}
            placeholder="e.g. PANTS LADIES"
          />
        </Box>
      )}

      {phase === 'exact-match' && exactRow && (
        <Box flexDirection="column">
          <Text color="green">✓ Match found for <Text bold>{exactRow.code}</Text></Text>
          <Text>  {exactRow.description ?? '(no description saved)'}</Text>
          {exactRow.suggested_category_id && (
            <Text dimColor>  Seen {exactRow.times_seen}× — last used category saved</Text>
          )}
          <Text dimColor>
            [a] apply saved category  [c] pick category  [Esc] close
          </Text>
        </Box>
      )}

      {phase === 'partial-match' && (
        <Box flexDirection="column">
          <Text color="yellow">Similar codes for <Text bold>{storeName}</Text>:</Text>
          {partialRows.map((row, i) => (
            <Text key={row.code} inverse={i === partialCursor}>
              {'  '}{row.code.padEnd(22)}{row.description ?? ''}
            </Text>
          ))}
          <Text dimColor>↑/↓ to select, Enter to view, Esc to close</Text>
        </Box>
      )}

      {phase === 'miss' && (
        <Box flexDirection="column">
          <Text color="yellow">No match for <Text bold>{codeInput}</Text> at <Text bold>{storeName}</Text>.</Text>
          {llmError && <Text color="red">LLM error: {llmError}</Text>}
          <Text dimColor>
            [m] enter description manually
            {anthropicApiKey ? '  [l] ask Claude for a guess' : '  (set anthropic_api_key to enable LLM)'}
            {'  '}[Esc] close
          </Text>
        </Box>
      )}

      {phase === 'manual-desc' && (
        <Box flexDirection="column">
          <Text>Enter a description for <Text bold>{codeInput}</Text>:</Text>
          <TextInput
            value={manualDesc}
            onChange={setManualDesc}
            onSubmit={handleManualDescSubmit}
            placeholder="e.g. Ladies pants / bottoms"
          />
        </Box>
      )}

      {phase === 'llm-loading' && (
        <Box flexDirection="column">
          <Text>Asking Claude about <Text bold>{codeInput}</Text>…</Text>
        </Box>
      )}

      {phase === 'llm-confirm' && (
        <Box flexDirection="column">
          <Text color="cyan">Claude's guess for <Text bold>{codeInput}</Text>:</Text>
          <Text>  {llmGuess?.description ?? '(no guess returned)'}</Text>
          {llmGuess?.confidence && (
            <Text dimColor>  Confidence: {llmGuess.confidence}</Text>
          )}
          <Text dimColor>[y] accept and pick category  [n] enter manually instead  [Esc] close</Text>
        </Box>
      )}

      {(phase === 'manual-category' || phase === 'llm-category') && (
        <Box flexDirection="column">
          <Text dimColor>
            Saving: <Text bold>{codeInput}</Text> → {manualDesc || llmGuess?.description || ''}
          </Text>
          <CategoryPicker
            groups={categoryGroups}
            onSelect={handleCategorySelect}
            onCancel={onClose}
          />
        </Box>
      )}
    </Box>
  );
}
