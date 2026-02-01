import React from 'react';
import { Text, Box } from 'ink';
import { useState, useEffect } from 'react';

const spinnerFrames = ['◐', '◓', '◑', '◒'];

interface SpinnerProps {
  message: string;
  subtasks?: string[];
}

export function Spinner({ message, subtasks = [] }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % spinnerFrames.length);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="yellow">{spinnerFrames[frame]}</Text> {message}
      </Text>
      {subtasks.map((task, i) => (
        <Text key={i} dimColor>
          {'  → '}{task}
        </Text>
      ))}
    </Box>
  );
}
