import { describe, it, expect } from 'vitest';
import { formatMilliunits } from '../src/format.js';

describe('formatMilliunits', () => {
  it('formats a negative amount as a dollar string', () => {
    expect(formatMilliunits(-84220)).toBe('-$84.22');
  });

  it('formats a positive amount (inflow)', () => {
    expect(formatMilliunits(100000)).toBe('+$100.00');
  });

  it('formats zero', () => {
    expect(formatMilliunits(0)).toBe('$0.00');
  });

  it('formats large amounts', () => {
    expect(formatMilliunits(-1234567)).toBe('-$1,234.57');
  });
});
