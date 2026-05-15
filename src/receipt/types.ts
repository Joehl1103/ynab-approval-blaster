// Shared types for the receipt-scan pipeline.
// The pipeline runs: capture (Shortcuts Take Photo) -> ocr (Swift Vision)
// -> parse (heuristic) -> suggest (payee history + keyword map).

export interface ReceiptItem {
  description: string;
  amount_milliunits: number; // signed: negative for outflow, matches YNAB convention
}

export interface ParsedReceipt {
  merchant: string | null;
  date: string | null; // ISO yyyy-mm-dd when detectable
  total_milliunits: number | null; // negative; aligns with YNAB tx amount
  items: ReceiptItem[];
  raw_lines: string[];
}

export type SuggestionReason =
  | { kind: 'payee_history'; pct: number; count: number }
  | { kind: 'keyword'; keyword: string }
  | { kind: 'none' };

export interface ReceiptSuggestion {
  category_id: string | null;
  category_name: string | null;
  reason: SuggestionReason;
  total_mismatch: boolean;
  total_diff_milliunits: number; // detected_total - tx_amount; 0 when no detected total
  merchant_match: 'matches' | 'differs' | 'unknown';
  date_match: 'matches' | 'differs' | 'unknown';
}

export interface KeywordRule {
  keywords: string[];
  category: string; // category name (resolved to id at suggest time)
}

export interface ReceiptConfig {
  enabled: boolean;
  shortcut_name: string;
  temp_dir: string;
  keyword_map: KeywordRule[];
}

export type CaptureErrorKind =
  | 'shortcut-missing'
  | 'shortcut-cancelled'
  | 'shortcut-failed'
  | 'output-missing';

export class CaptureError extends Error {
  constructor(public kind: CaptureErrorKind, message: string) {
    super(message);
    this.name = 'CaptureError';
  }
}

export type OcrErrorKind = 'swift-missing' | 'ocr-failed' | 'no-text';

export class OcrError extends Error {
  constructor(public kind: OcrErrorKind, message: string) {
    super(message);
    this.name = 'OcrError';
  }
}
