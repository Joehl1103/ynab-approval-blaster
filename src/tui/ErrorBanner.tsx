import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  errors: string[];
  onDismiss: () => void;
}

// Non-blocking error banner. Shows the first error with a dismiss prompt.
export function ErrorBanner({ errors, onDismiss }: Props) {
  if (errors.length === 0) return null;
  return (
    <Box borderStyle="single" borderColor="red" marginY={1} paddingX={1}>
      <Text color="red">{errors[0]}</Text>
      <Text dimColor> — press [d] to dismiss</Text>
    </Box>
  );
}
