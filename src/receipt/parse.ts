import type { ParsedReceipt, ReceiptItem } from './types.js';

// Regexes used by the parser. Kept local + named so the heuristics stay readable.
// Vision OCR tends to emit one logical line per array entry, but item rows can
// either come back joined ("MILK 2%   3.99") or split across two lines
// ("MILK 2%" + "3.99"). We handle both shapes.

const AMOUNT_TAIL = /^(.*?)[ \t]+\$?(-?\d{1,3}(?:,\d{3})*\.\d{2})$/;
const AMOUNT_ONLY = /^\$?(-?\d{1,3}(?:,\d{3})*\.\d{2})$/;
const DATE_PATTERNS: { re: RegExp; toIso: (m: RegExpMatchArray) => string | null }[] = [
  // 2026-04-15 / 2026/04/15
  {
    re: /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/,
    toIso: (m) => isoFromYmd(+m[1]!, +m[2]!, +m[3]!),
  },
  // 04/15/2026 or 4-15-26
  {
    re: /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})\b/,
    toIso: (m) => {
      const yr = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
      return isoFromYmd(yr, +m[1]!, +m[2]!);
    },
  },
];

const TOTAL_KEYWORDS = /\b(grand\s*total|total\s*due|amount\s*due|total|balance|amt)\b/i;
const SUBTOTAL_KEYWORDS = /\b(sub[\s-]?total|tax|change|tender|cash|debit|credit|visa|mastercard|amex)\b/i;

function isoFromYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function toMilliunits(amountStr: string): number {
  // amountStr is the raw decimal capture, possibly with comma thousand separators.
  const cleaned = amountStr.replace(/,/g, '');
  return Math.round(parseFloat(cleaned) * 1000);
}

// Pulls the first plausible date out of the OCR lines.
function detectDate(lines: string[]): string | null {
  for (const line of lines) {
    for (const p of DATE_PATTERNS) {
      const m = line.match(p.re);
      if (m) {
        const iso = p.toIso(m);
        if (iso) return iso;
      }
    }
  }
  return null;
}

// Best-guess merchant: scan top of receipt for the first line that's mostly
// letters and isn't an obvious address / phone / item / amount.
function detectMerchant(lines: string[]): string | null {
  const head = lines.slice(0, Math.min(8, lines.length));
  for (const raw of head) {
    const line = raw.trim();
    if (!line) continue;
    if (AMOUNT_ONLY.test(line)) continue;
    if (AMOUNT_TAIL.test(line)) continue;
    if (/^\d/.test(line)) continue; // address line
    if (/^\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(line)) continue; // phone
    const letters = line.replace(/[^a-zA-Z]/g, '').length;
    if (letters < 3) continue;
    return line;
  }
  return head[0]?.trim() ?? null;
}

// Strips obvious sentinels from a description: leading qty markers, trailing
// SKU codes, and "@ $X.XX EA" suffixes.
function cleanDescription(desc: string): string {
  return desc
    .replace(/\s+@\s+\$?\d+(?:\.\d{2})?(?:\s*\/?\s*EA)?$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Item detection: walks the lines top-to-bottom, joining "<desc>\n<amount>" pairs
// when the amount lives on its own line, and treating "<desc>  <amount>" as a
// single-line item. Lines that look like totals/tax/subtotals are excluded.
function detectItems(lines: string[]): { items: ReceiptItem[]; totalCandidates: { value: number; line: string }[] } {
  const items: ReceiptItem[] = [];
  const totalCandidates: { value: number; line: string }[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const tail = line.match(AMOUNT_TAIL);
    const onlyAmount = line.match(AMOUNT_ONLY);

    if (tail) {
      const desc = cleanDescription(tail[1]!);
      const value = toMilliunits(tail[2]!);
      if (TOTAL_KEYWORDS.test(line)) {
        totalCandidates.push({ value, line });
      } else if (!SUBTOTAL_KEYWORDS.test(line) && desc.length > 0) {
        items.push({ description: desc, amount_milliunits: -Math.abs(value) });
      }
      i += 1;
      continue;
    }

    if (onlyAmount && i > 0) {
      const prev = lines[i - 1]!;
      const value = toMilliunits(onlyAmount[1]!);
      const combined = `${prev} ${line}`;
      if (TOTAL_KEYWORDS.test(prev)) {
        totalCandidates.push({ value, line: combined });
      } else if (!SUBTOTAL_KEYWORDS.test(prev)) {
        const desc = cleanDescription(prev);
        if (
          desc.length > 0 &&
          // Don't double-count: only consume `prev` if the previous push didn't
          // already cover it.
          (items.length === 0 || items[items.length - 1]!.description !== desc)
        ) {
          items.push({ description: desc, amount_milliunits: -Math.abs(value) });
        }
      }
      i += 1;
      continue;
    }

    i += 1;
  }
  return { items, totalCandidates };
}

// Picks the best total from the candidates. Preference order:
//   1. Highest-magnitude line that explicitly says "grand total".
//   2. Highest-magnitude line containing any total keyword.
//   3. Largest amount-only line in the bottom third of the receipt.
function detectTotal(
  totalCandidates: { value: number; line: string }[],
  lines: string[]
): number | null {
  const grand = totalCandidates.filter((c) => /grand\s*total/i.test(c.line));
  if (grand.length > 0) {
    return -Math.max(...grand.map((c) => Math.abs(c.value)));
  }
  if (totalCandidates.length > 0) {
    return -Math.max(...totalCandidates.map((c) => Math.abs(c.value)));
  }
  // Last-resort fallback: largest amount in the bottom third, ignoring tax/etc.
  const tail = lines.slice(Math.floor(lines.length * 2 / 3));
  const amounts: number[] = [];
  for (const l of tail) {
    if (SUBTOTAL_KEYWORDS.test(l)) continue;
    const m = l.match(AMOUNT_ONLY) ?? l.match(AMOUNT_TAIL);
    if (m) amounts.push(toMilliunits(m[m.length - 1]!));
  }
  if (amounts.length === 0) return null;
  return -Math.max(...amounts);
}

// Pure heuristic parser. Takes the raw OCR lines (already trimmed and
// non-empty) and produces a best-effort structured receipt. Designed to be
// robust against the worst-case OCR output rather than perfect against ideal
// receipts.
export function parseReceipt(lines: string[]): ParsedReceipt {
  if (lines.length === 0) {
    return { merchant: null, date: null, total_milliunits: null, items: [], raw_lines: [] };
  }
  const merchant = detectMerchant(lines);
  const date = detectDate(lines);
  const { items, totalCandidates } = detectItems(lines);
  const total_milliunits = detectTotal(totalCandidates, lines);
  return { merchant, date, total_milliunits, items, raw_lines: lines };
}
