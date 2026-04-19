import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { fuzzyFilter } from '../fuzzy.js';
import type { CategoryRow } from '../db/categories.js';

interface Item {
  label: string;
  value: string;
}

interface Props {
  categories: CategoryRow[];
  onSelect: (categoryId: string, categoryName: string) => void;
  onCancel: () => void;
}

// Full-screen category picker. Text input at the top fuzzy-filters the list below.
// Enter selects, Escape cancels.
export function CategoryPicker({ categories, onSelect, onCancel }: Props) {
  const [query, setQuery] = useState('');

  const filtered = fuzzyFilter(
    categories.map((c) => c.name),
    query
  );

  const items: Item[] = filtered.map((name) => {
    const cat = categories.find((c) => c.name === name)!;
    return { label: name, value: cat.id };
  });

  useInput((_, key) => {
    if (key.escape) onCancel();
  });

  const handleSelect = (item: Item) => {
    const cat = categories.find((c) => c.id === item.value)!;
    onSelect(cat.id, cat.name);
  };

  return (
    <Box flexDirection="column">
      <Text bold>Select category (Esc to cancel):</Text>
      <TextInput value={query} onChange={setQuery} placeholder="type to filter..." />
      {items.length > 0 ? (
        <SelectInput items={items} onSelect={handleSelect} />
      ) : (
        <Text dimColor>No matching categories</Text>
      )}
    </Box>
  );
}
