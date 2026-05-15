import { readFileSync } from 'fs';
import { homedir } from 'os';
import { load } from 'js-yaml';
import type { ReceiptConfig, KeywordRule } from './receipt/types.js';

export type SortOrder = 'date_desc' | 'date_asc' | 'account';

export interface AmazonConfig {
  enabled: boolean;
  match_window_days: number;
  bootstrap_days: number;
  payee_pattern: string;
  stale_warning_hours: number;
}

export interface Config {
  personal_access_token: string;
  budget_id: string;
  db_path: string;
  include_hidden_categories: boolean;
  sort: SortOrder;
  receipt: ReceiptConfig | null;
  amazon: AmazonConfig;
}

const VALID_SORTS: SortOrder[] = ['date_desc', 'date_asc', 'account'];
const CONFIG_PATH = `${homedir()}/.config/ynab-blaster/config.yml`;

const DEFAULT_KEYWORD_MAP: KeywordRule[] = [
  { keywords: ['grocer', 'produce', 'dairy', 'bakery', 'deli', 'meat'], category: 'Groceries' },
  { keywords: ['pharmacy', 'rx', 'prescription'], category: 'Pharmacy' },
  { keywords: ['gas', 'fuel', 'unleaded', 'diesel'], category: 'Gas' },
  { keywords: ['restaurant', 'cafe', 'coffee', 'bistro', 'grill'], category: 'Eating Out' },
];

// Validates and shapes the optional `receipt` block. Returns null when the
// block is absent, so callers can branch on `config.receipt === null` instead
// of probing each sub-key.
function parseReceipt(raw: unknown): ReceiptConfig | null {
  if (raw === undefined || raw === null) {
    return {
      enabled: true,
      shortcut_name: 'ynab-blaster-receipt',
      temp_dir: '~/.cache/ynab-blaster',
      keyword_map: DEFAULT_KEYWORD_MAP,
    };
  }
  if (typeof raw !== 'object') {
    throw new Error('Config error: receipt must be a mapping');
  }
  const r = raw as Record<string, unknown>;
  const enabled = (r.enabled as boolean | undefined) ?? true;
  const shortcut_name = (r.shortcut_name as string | undefined) ?? 'ynab-blaster-receipt';
  const temp_dir = (r.temp_dir as string | undefined) ?? '~/.cache/ynab-blaster';
  const rawMap = r.keyword_map as unknown;
  let keyword_map: KeywordRule[] = DEFAULT_KEYWORD_MAP;
  if (Array.isArray(rawMap)) {
    keyword_map = rawMap.map((entry, i) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !Array.isArray((entry as Record<string, unknown>).keywords) ||
        typeof (entry as Record<string, unknown>).category !== 'string'
      ) {
        throw new Error(`Config error: receipt.keyword_map[${i}] must have keywords[] and category string`);
      }
      const e = entry as { keywords: unknown[]; category: string };
      return {
        keywords: e.keywords.map((k) => String(k)),
        category: e.category,
      };
    });
  }
  return { enabled, shortcut_name, temp_dir, keyword_map };
}

// Validates and coerces a raw YAML-parsed object into a typed Config.
// Throws with a descriptive message pointing to the offending key.
export function parseConfig(raw: Record<string, unknown>): Config {
  if (!raw.personal_access_token || typeof raw.personal_access_token !== 'string') {
    throw new Error('Config error: personal_access_token is required');
  }
  if (!raw.budget_id || typeof raw.budget_id !== 'string') {
    throw new Error('Config error: budget_id is required');
  }
  if (!raw.db_path || typeof raw.db_path !== 'string') {
    throw new Error('Config error: db_path is required');
  }
  const sort = (raw.sort as SortOrder) ?? 'date_desc';
  if (!VALID_SORTS.includes(sort)) {
    throw new Error(`Config error: sort must be one of ${VALID_SORTS.join(', ')}`);
  }
  const rawAmazon = (raw.amazon ?? {}) as Record<string, unknown>;

  return {
    personal_access_token: raw.personal_access_token,
    budget_id: raw.budget_id,
    db_path: (raw.db_path as string).replace('~', homedir()),
    include_hidden_categories: (raw.include_hidden_categories as boolean) ?? false,
    sort,
    receipt: parseReceipt(raw.receipt),
    amazon: {
      enabled: (rawAmazon.enabled as boolean) ?? false,
      match_window_days: (rawAmazon.match_window_days as number) ?? 7,
      bootstrap_days: (rawAmazon.bootstrap_days as number) ?? 90,
      payee_pattern: (rawAmazon.payee_pattern as string) ?? 'amazon|amzn',
      stale_warning_hours: (rawAmazon.stale_warning_hours as number) ?? 24,
    },
  };
}

// Reads and parses config.yml from the standard config location.
export function loadConfig(): Config {
  const raw = load(readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
  return parseConfig(raw);
}
