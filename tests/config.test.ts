import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/config.js';

describe('parseConfig', () => {
  it('parses a valid config object', () => {
    const raw = {
      personal_access_token: 'abc123',
      budget_id: 'uuid-budget',
      db_path: '~/.local/share/ynab-blaster/ynab.db',
      include_hidden_categories: false,
      sort: 'date_desc',
    };
    const config = parseConfig(raw);
    expect(config.personal_access_token).toBe('abc123');
    expect(config.sort).toBe('date_desc');
  });

  it('throws on missing personal_access_token', () => {
    expect(() => parseConfig({ budget_id: 'x', db_path: 'y' })).toThrow(
      'personal_access_token'
    );
  });

  it('throws on invalid sort value', () => {
    expect(() =>
      parseConfig({
        personal_access_token: 'x',
        budget_id: 'y',
        db_path: 'z',
        sort: 'invalid',
      })
    ).toThrow('sort');
  });

  it('defaults include_hidden_categories to false', () => {
    const config = parseConfig({
      personal_access_token: 'x',
      budget_id: 'y',
      db_path: 'z',
    });
    expect(config.include_hidden_categories).toBe(false);
  });
});
