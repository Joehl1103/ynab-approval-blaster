// YNAB stores amounts as milliunits (1/1000 of a currency unit).
// Converts to a display string: -84220 → "-$84.22", 100000 → "+$100.00"
export function formatMilliunits(milliunits: number): string {
  const dollars = milliunits / 1000;
  const abs = Math.abs(dollars);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (milliunits > 0) return `+$${formatted}`;
  if (milliunits < 0) return `-$${formatted}`;
  return `$${formatted}`;
}
