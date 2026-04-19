import React from 'react';
import { Box, Text } from 'ink';

// Keybind legend shown at the bottom of the default mode screen.
export function Footer() {
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray">
      <Text dimColor>
        [y/↵] approve  [c] category  [n] next  [s] skip  [x] flag split  [m] memo  [u] undo  [q] quit
      </Text>
    </Box>
  );
}
