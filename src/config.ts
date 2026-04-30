import { readFileSync } from 'fs';
import { homedir } from 'os';
import { load } from 'js-yaml';

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
  amazon: AmazonConfig;
}

const VALID_SORTS: SortOrder[] = ['date_desc', 'date_asc', 'account'];
const CONFIG_PATH = `${homedir()}/.config/ynab-blaster/config.yml`;

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
