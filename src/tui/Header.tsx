import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  current: number;
  total: number;
  syncing: boolean;
  amazonStaleHours?: number | null;  // null = feature disabled; undefined = fresh
}

// Displays position in queue and sync state at the top of the screen.
// Shows an Amazon staleness chip when last_success is older than the threshold.
export function Header({ current, total, syncing, amazonStaleHours }: Props) {
  return (
    <Box marginBottom={1}>
      <Text bold>[{current}/{total}] </Text>
      {syncing && <Text color="yellow"> syncing...</Text>}
      {amazonStaleHours != null && amazonStaleHours >= 1 && (
        <Text color="yellow">  Amazon: stale ({Math.round(amazonStaleHours)}h)</Text>
      )}
    </Box>
  );
}
