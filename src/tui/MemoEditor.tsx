import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  initialMemo: string;
  onSubmit: (memo: string) => void;
  onCancel: () => void;
}

// Inline memo editor. Enter submits, Escape cancels.
export function MemoEditor({ initialMemo, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initialMemo);

  useInput((_, key) => {
    if (key.escape) onCancel();
    if (key.return) onSubmit(value);
  });

  return (
    <Box flexDirection="column">
      <Text bold>Edit memo (Enter to save, Esc to cancel):</Text>
      <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
    </Box>
  );
}
