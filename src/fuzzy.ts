// Case-insensitive substring filter. Returns items whose name contains the query anywhere.
export function fuzzyFilter(items: string[], query: string): string[] {
  if (!query) return items;
  const lower = query.toLowerCase();
  return items.filter((item) => item.toLowerCase().includes(lower));
}
