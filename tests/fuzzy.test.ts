import { describe, it, expect } from 'vitest';
import { fuzzyFilter } from '../src/fuzzy.js';

describe('fuzzyFilter', () => {
  it('returns all items when query is empty', () => {
    const items = ['Groceries', 'Household', 'Eating Out'];
    expect(fuzzyFilter(items, '')).toEqual(items);
  });

  it('filters case-insensitively', () => {
    const items = ['Groceries', 'Household', 'Eating Out'];
    expect(fuzzyFilter(items, 'groc')).toEqual(['Groceries']);
  });

  it('matches substring in the middle of a word', () => {
    const items = ['Subscriptions', 'Groceries', 'Gas'];
    expect(fuzzyFilter(items, 'script')).toEqual(['Subscriptions']);
  });

  it('returns empty array when nothing matches', () => {
    expect(fuzzyFilter(['Groceries'], 'xyz')).toEqual([]);
  });

  it('matches multiple items', () => {
    const items = ['Gas & Fuel', 'Gas Utilities', 'Groceries'];
    expect(fuzzyFilter(items, 'gas')).toEqual(['Gas & Fuel', 'Gas Utilities']);
  });
});
