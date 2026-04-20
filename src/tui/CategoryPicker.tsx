import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { fuzzyFilter } from '../fuzzy.js';
import { formatMilliunits } from '../format.js';
import type { CategoryGroup, CategoryRow } from '../db/categories.js';

interface Props {
  groups: CategoryGroup[];
  onSelect: (categoryId: string, categoryName: string) => void;
  onCancel: () => void;
}

const NAME_WIDTH = 34;

function balanceColor(ms: number): 'green' | 'red' | undefined {
  if (ms > 0) return 'green';
  if (ms < 0) return 'red';
  return undefined;
}

// Grouped category picker that mimics YNAB's budget-category grid.
// Each group renders as a bold header with its categories beneath; rows show
// the Available balance, color-coded by sign. A TextInput at the top fuzzy-
// filters category names; groups with no matches collapse out of view.
// Hidden categories are never shown here, regardless of config.
export function CategoryPicker({ groups, onSelect, onCancel }: Props) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const filtered = useMemo<CategoryGroup[]>(() => {
    if (!query) return groups.filter((g) => g.categories.length > 0);
    return groups
      .map((g) => {
        const matches = fuzzyFilter(
          g.categories.map((c) => c.name),
          query
        );
        const matchSet = new Set(matches);
        return { group: g.group, categories: g.categories.filter((c) => matchSet.has(c.name)) };
      })
      .filter((g) => g.categories.length > 0);
  }, [groups, query]);

  const flatItems = useMemo<CategoryRow[]>(
    () => filtered.flatMap((g) => g.categories),
    [filtered]
  );

  // Clamp the cursor whenever the filtered list changes.
  useEffect(() => {
    setCursor(0);
  }, [flatItems.length]);

  useInput((_, key) => {
    if (key.escape) return onCancel();
    if (flatItems.length === 0) return;
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(flatItems.length - 1, c + 1));
    if (key.return) {
      const pick = flatItems[cursor];
      if (pick) onSelect(pick.id, pick.name);
    }
  });

  let flatIndex = 0;

  return (
    <Box flexDirection="column">
      <Text bold>Select category (Esc to cancel):</Text>
      <TextInput value={query} onChange={setQuery} placeholder="type to filter..." />
      {flatItems.length === 0 ? (
        <Text dimColor>No matching categories</Text>
      ) : (
        filtered.map((g) => (
          <Box key={g.group} flexDirection="column" marginTop={1}>
            <Box>
              <Box width={NAME_WIDTH + 3} flexShrink={0}>
                <Text bold color="cyan">{g.group}</Text>
              </Box>
              <Text dimColor>Available (this month)</Text>
            </Box>
            {g.categories.map((c) => {
              const isActive = flatIndex === cursor;
              flatIndex += 1;
              const balance = formatMilliunits(c.balance).replace(/^\+/, '');
              const color = balanceColor(c.balance);
              return (
                <Text key={c.id} inverse={isActive}>
                  {'  '}
                  {c.name.padEnd(NAME_WIDTH)}
                  {' '}
                  <Text color={color} dimColor={c.balance === 0}>{balance}</Text>
                </Text>
              );
            })}
          </Box>
        ))
      )}
    </Box>
  );
}
