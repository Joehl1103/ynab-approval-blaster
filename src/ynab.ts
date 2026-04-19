import * as ynab from 'ynab';
import type { Config } from './config.js';

// Creates a YNAB API client using the personal access token from config.
export function createYnabClient(config: Config): ynab.API {
  return new ynab.API(config.personal_access_token);
}
