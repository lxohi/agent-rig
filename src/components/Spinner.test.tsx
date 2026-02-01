import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Spinner } from './Spinner.js';

describe('Spinner', () => {
  it('renders with message', () => {
    const { lastFrame } = render(<Spinner message="Loading..." />);
    expect(lastFrame()).toContain('Loading...');
  });

  it('renders with subtasks', () => {
    const { lastFrame } = render(
      <Spinner message="Creating sandbox" subtasks={['Cloning template', 'Configuring']} />
    );
    expect(lastFrame()).toContain('Creating sandbox');
    expect(lastFrame()).toContain('Cloning template');
  });
});
