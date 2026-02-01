import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { TaskList, type Task } from './TaskList.js';

describe('TaskList', () => {
  it('renders completed tasks with checkmark', () => {
    const tasks: Task[] = [{ label: 'Install packages', status: 'completed' }];
    const { lastFrame } = render(<TaskList tasks={tasks} />);
    expect(lastFrame()).toContain('✓');
    expect(lastFrame()).toContain('Install packages');
  });

  it('renders pending tasks with spinner', () => {
    const tasks: Task[] = [{ label: 'Clone repo', status: 'pending' }];
    const { lastFrame } = render(<TaskList tasks={tasks} />);
    expect(lastFrame()).toContain('Clone repo');
  });

  it('renders failed tasks with X', () => {
    const tasks: Task[] = [{ label: 'Build failed', status: 'failed' }];
    const { lastFrame } = render(<TaskList tasks={tasks} />);
    expect(lastFrame()).toContain('✗');
    expect(lastFrame()).toContain('Build failed');
  });
});
