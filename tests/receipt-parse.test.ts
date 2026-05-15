import { describe, it, expect } from 'vitest';
import { parseReceipt } from '../src/receipt/parse.js';

const TARGET = [
  'TARGET',
  'Expect More. Pay Less.',
  '1234 Main St',
  '(612) 555-0100',
  '04/15/2026  14:32',
  'GROCERY',
  'MILK 2%        3.99',
  'BREAD          4.49',
  'EGGS DOZEN     5.29',
  'HOUSEHOLD',
  'DETERGENT      12.99',
  'PAPER TOWELS   8.99',
  'SUBTOTAL       35.75',
  'TAX            2.18',
  'TOTAL          37.93',
  'VISA           37.93',
  'CHANGE         0.00',
  'THANK YOU',
];

const COSTCO_SPLIT = [
  'COSTCO WHOLESALE',
  '5050 Marketplace Dr',
  '03-22-26',
  'ROTISSERIE CHKN',
  '4.99',
  'BANANAS ORG',
  '2.49',
  'PAPER TOWELS',
  '21.99',
  'SUBTOTAL',
  '29.47',
  'TAX',
  '1.80',
  'GRAND TOTAL',
  '31.27',
];

describe('parseReceipt', () => {
  it('extracts merchant, date, total, and line items from a Target-style receipt', () => {
    const r = parseReceipt(TARGET);
    expect(r.merchant).toBe('TARGET');
    expect(r.date).toBe('2026-04-15');
    // Total is signed as outflow (negative milliunits).
    expect(r.total_milliunits).toBe(-37930);
    expect(r.items.length).toBeGreaterThanOrEqual(5);
    expect(r.items.find((i) => i.description.startsWith('MILK'))?.amount_milliunits).toBe(-3990);
    expect(r.items.find((i) => i.description.startsWith('DETERGENT'))?.amount_milliunits).toBe(-12990);
    // Subtotal/tax/totals must not be folded into items.
    expect(r.items.some((i) => /SUBTOTAL/i.test(i.description))).toBe(false);
    expect(r.items.some((i) => /^TAX$/i.test(i.description))).toBe(false);
    expect(r.items.some((i) => /^TOTAL$/i.test(i.description))).toBe(false);
  });

  it('reconstructs split-line items where the amount is on its own line', () => {
    const r = parseReceipt(COSTCO_SPLIT);
    expect(r.merchant).toBe('COSTCO WHOLESALE');
    expect(r.date).toBe('2026-03-22');
    // GRAND TOTAL beats plain TOTAL/SUBTOTAL.
    expect(r.total_milliunits).toBe(-31270);
    expect(r.items.find((i) => i.description.startsWith('ROTISSERIE'))?.amount_milliunits).toBe(-4990);
    expect(r.items.find((i) => i.description.startsWith('BANANAS'))?.amount_milliunits).toBe(-2490);
    expect(r.items.find((i) => i.description.startsWith('PAPER TOWELS'))?.amount_milliunits).toBe(-21990);
  });

  it('returns null fields when given empty input', () => {
    const r = parseReceipt([]);
    expect(r.merchant).toBeNull();
    expect(r.date).toBeNull();
    expect(r.total_milliunits).toBeNull();
    expect(r.items).toEqual([]);
  });

  it('skips obvious non-merchant header lines (address, phone, amounts)', () => {
    const r = parseReceipt([
      '$5.00',
      '(555) 555-1212',
      '999 Elm Avenue',
      'BOB\'S DINER',
      'BURGER  9.99',
      'TOTAL  9.99',
    ]);
    expect(r.merchant).toBe("BOB'S DINER");
  });

  it('falls back to largest bottom-third amount when no total keyword is present', () => {
    const r = parseReceipt([
      'CORNER STORE',
      'CANDY  1.50',
      'SODA   2.99',
      'CASH   5.00',
      '4.49',
    ]);
    // No TOTAL/GRAND TOTAL keyword so the bottom-third largest amount wins.
    // The CASH line is filtered as a payment method, leaving the standalone 4.49.
    expect(r.total_milliunits).toBe(-4490);
  });

  it('parses ISO date format too', () => {
    const r = parseReceipt(['SHOP', '2026-12-31', 'ITEM 1.00', 'TOTAL 1.00']);
    expect(r.date).toBe('2026-12-31');
  });
});
