import React from 'react';
import { Box, Text } from 'ink';
import { formatMilliunits } from '../format.js';
import type { AmazonMatch } from '../amazon/types.js';

interface Props {
  match: AmazonMatch;
}

// Displays the matched Amazon order between the payee history and the suggestion line.
// Single-item orders confirm cleanly. Multi-item orders nudge the user toward [x].
export function AmazonOrderPanel({ match }: Props) {
  const { charge, items, ambiguous } = match;
  const isMultiItem = items.length > 1;

  return (
    <Box flexDirection="column" marginY={1} borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box>
        <Text bold color="cyan">Amazon  </Text>
        <Text dimColor>#{charge.order_number}  </Text>
        <Text dimColor>(charged {charge.completed_date})</Text>
        {ambiguous && <Text color="yellow">  ⚠ multiple matches</Text>}
      </Box>

      {items.length > 0 ? (
        items.map((item, i) => (
          <Box key={i}>
            <Text>  {item.quantity}x  </Text>
            <Text>{(item.title || '').slice(0, 55).padEnd(55)}</Text>
            <Text dimColor>
              {'  '}
              {item.price_milliunits != null
                ? formatMilliunits(item.price_milliunits * item.quantity)
                : ''}
            </Text>
          </Box>
        ))
      ) : (
        <Text dimColor>  (item details not available — run `ynab-blaster amazon-sync` to refresh)</Text>
      )}

      <Box marginTop={1}>
        {isMultiItem ? (
          <Text color="yellow">⚠ multi-item order — recommended: <Text bold>[x]</Text> flag for split</Text>
        ) : (
          <Text color="green">✓ single item — pick a category and approve</Text>
        )}
      </Box>
    </Box>
  );
}
