import React from 'react';
import { Text } from 'ink';

interface StatusLineProps {
  status: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

const statusConfig = {
  success: { symbol: '✓', color: 'green' as const },
  error: { symbol: '✗', color: 'red' as const },
  warning: { symbol: '!', color: 'yellow' as const },
  info: { symbol: '•', color: 'blue' as const },
};

export function StatusLine({ status, message }: StatusLineProps) {
  const config = statusConfig[status];

  return (
    <Text>
      <Text color={config.color}>{config.symbol}</Text> {message}
    </Text>
  );
}
