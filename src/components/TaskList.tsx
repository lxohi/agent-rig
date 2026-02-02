import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';

const spinnerFrames = ['◐', '◓', '◑', '◒'];

export interface Task {
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

interface TaskListProps {
  tasks: Task[];
}

export function TaskList({ tasks }: TaskListProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const hasRunning = tasks.some((t) => t.status === 'running');
    if (!hasRunning) return;

    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % spinnerFrames.length);
    }, 100);
    return () => clearInterval(timer);
  }, [tasks]);

  return (
    <Box flexDirection="column">
      {tasks.map((task, i) => (
        <Box key={i}>
          <Text>
            {task.status === 'completed' && <Text color="green">✓ </Text>}
            {task.status === 'failed' && <Text color="red">✗ </Text>}
            {task.status === 'running' && (
              <Text color="yellow">{spinnerFrames[frame]} </Text>
            )}
            {task.status === 'pending' && <Text dimColor>○ </Text>}
            <Text dimColor={task.status === 'pending' || task.status === 'completed'}>
              {task.label}
            </Text>
          </Text>
        </Box>
      ))}
    </Box>
  );
}
