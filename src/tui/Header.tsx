import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  current: number;
  total: number;
  syncing: boolean;
}

// Displays position in queue and sync state at the top of the screen.
export function Header({ current, total, syncing }: Props) {
  return (
    <Box marginBottom={1}>
      <Text bold>[{current}/{total}] </Text>
      {syncing && <Text color="yellow"> syncing...</Text>}
    </Box>
  );
}
