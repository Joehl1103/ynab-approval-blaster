import type { CategoryRow } from '../db/categories.js';
import type { HistoryRow } from '../db/history.js';
import type { TransactionRow } from '../db/transactions.js';
import type {
  KeywordRule,
  ParsedReceipt,
  ReceiptSuggestion,
  SuggestionReason,
} from './types.js';

// Tolerance when comparing the receipt's detected total to the YNAB
// transaction amount. OCR drops decimal points; payees post tips as separate
// lines; fees post on a different day. 50¢ is generous enough to absorb
// rounding without hiding "wrong receipt" mistakes.
const TOTAL_TOLERANCE_MILLIUNITS = 500;

// Threshold for declaring a payee-history suggestion a strong match.
// Below this, we still surface the suggestion but flag it as weak so the
// keyword fallback can override.
const PAYEE_HISTORY_MIN_PCT = 50;

interface SuggestInputs {
  parsed: ParsedReceipt;
  transaction: TransactionRow;
  categories: CategoryRow[];
  history: HistoryRow[]; // payee history rows for transaction.payee_id
  keywordMap: KeywordRule[];
}

function payeeHistorySuggestion(
  history: HistoryRow[],
  categories: CategoryRow[]
): { id: string; name: string; pct: number; count: number } | null {
  if (history.length === 0) return null;
  const total = history.reduce((sum, h) => sum + h.count, 0);
  if (total === 0) return null;
  const top = history[0]!;
  const cat = categories.find((c) => c.id === top.category_id);
  if (!cat) return null;
  return {
    id: cat.id,
    name: cat.name,
    pct: Math.round((top.count / total) * 100),
    count: top.count,
  };
}

function keywordSuggestion(
  parsed: ParsedReceipt,
  categories: CategoryRow[],
  keywordMap: KeywordRule[]
): { id: string; name: string; keyword: string } | null {
  if (keywordMap.length === 0) return null;
  const haystack = [
    parsed.merchant ?? '',
    ...parsed.items.map((i) => i.description),
    ...parsed.raw_lines,
  ]
    .join(' ')
    .toLowerCase();
  for (const rule of keywordMap) {
    for (const kw of rule.keywords) {
      const needle = kw.toLowerCase();
      if (haystack.includes(needle)) {
        const cat = categories.find(
          (c) => c.name.toLowerCase() === rule.category.toLowerCase()
        );
        if (cat) {
          return { id: cat.id, name: cat.name, keyword: kw };
        }
      }
    }
  }
  return null;
}

// Compares the detected merchant string to the transaction's payee name.
// Loose normalization: case, punctuation, store numbers all stripped.
function compareMerchant(
  detected: string | null,
  payeeName: string | null
): 'matches' | 'differs' | 'unknown' {
  if (!detected || !payeeName) return 'unknown';
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/#\s*\d+/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const a = norm(detected);
  const b = norm(payeeName);
  if (!a || !b) return 'unknown';
  if (a === b) return 'matches';
  if (a.includes(b) || b.includes(a)) return 'matches';
  // First two tokens overlap is a soft match (TARGET 1234 vs TARGET STORE).
  const aHead = a.split(' ').slice(0, 2).join(' ');
  const bHead = b.split(' ').slice(0, 2).join(' ');
  if (aHead === bHead && aHead.length > 2) return 'matches';
  return 'differs';
}

function compareDate(
  detected: string | null,
  txDate: string
): 'matches' | 'differs' | 'unknown' {
  if (!detected) return 'unknown';
  if (detected === txDate) return 'matches';
  // Soft tolerance: same date within 3 days handles weekend posting drift.
  const a = new Date(detected).getTime();
  const b = new Date(txDate).getTime();
  if (!Number.isNaN(a) && !Number.isNaN(b)) {
    const diffDays = Math.abs(a - b) / (1000 * 60 * 60 * 24);
    if (diffDays <= 3) return 'matches';
  }
  return 'differs';
}

// Pure suggestion logic. Inputs are the parsed receipt, the current
// transaction, the full category list, the transaction's payee history rows,
// and the user's keyword map. Output is the suggested category plus a bag of
// derived comparisons used by the UI (merchant/date/total match flags).
export function suggestFromReceipt(inputs: SuggestInputs): ReceiptSuggestion {
  const { parsed, transaction, categories, history, keywordMap } = inputs;

  // Match flags first — independent of which suggestion source wins.
  const merchant_match = compareMerchant(parsed.merchant, transaction.payee_name);
  const date_match = compareDate(parsed.date, transaction.date);

  let total_diff_milliunits = 0;
  let total_mismatch = false;
  if (parsed.total_milliunits !== null) {
    total_diff_milliunits = parsed.total_milliunits - transaction.amount;
    total_mismatch = Math.abs(total_diff_milliunits) > TOTAL_TOLERANCE_MILLIUNITS;
  }

  // 1. Payee history (strong)
  const fromHistory = payeeHistorySuggestion(history, categories);
  if (fromHistory && fromHistory.pct >= PAYEE_HISTORY_MIN_PCT) {
    const reason: SuggestionReason = {
      kind: 'payee_history',
      pct: fromHistory.pct,
      count: fromHistory.count,
    };
    return {
      category_id: fromHistory.id,
      category_name: fromHistory.name,
      reason,
      total_mismatch,
      total_diff_milliunits,
      merchant_match,
      date_match,
    };
  }

  // 2. Keyword map fallback
  const fromKeyword = keywordSuggestion(parsed, categories, keywordMap);
  if (fromKeyword) {
    return {
      category_id: fromKeyword.id,
      category_name: fromKeyword.name,
      reason: { kind: 'keyword', keyword: fromKeyword.keyword },
      total_mismatch,
      total_diff_milliunits,
      merchant_match,
      date_match,
    };
  }

  // 3. Weak payee history (still better than nothing)
  if (fromHistory) {
    const reason: SuggestionReason = {
      kind: 'payee_history',
      pct: fromHistory.pct,
      count: fromHistory.count,
    };
    return {
      category_id: fromHistory.id,
      category_name: fromHistory.name,
      reason,
      total_mismatch,
      total_diff_milliunits,
      merchant_match,
      date_match,
    };
  }

  return {
    category_id: null,
    category_name: null,
    reason: { kind: 'none' },
    total_mismatch,
    total_diff_milliunits,
    merchant_match,
    date_match,
  };
}
