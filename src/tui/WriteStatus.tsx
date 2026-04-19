import React from 'react';
import { Text } from 'ink';
import Spinner from 'ink-spinner';
import type { WriteStatus } from './reducer.js';

interface Props {
  status: WriteStatus;
}

// Bottom-right indicator showing the status of the most recent write.
export function WriteStatus({ status }: Props) {
  if (status === 'idle') return null;
  if (status === 'saving') return <Text><Spinner type="dots" /> saving</Text>;
  if (status === 'saved') return <Text color="green">✓ saved</Text>;
  if (status === 'failed') return <Text color="red">✗ failed</Text>;
  return null;
}
