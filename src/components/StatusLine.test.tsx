import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { StatusLine } from './StatusLine.js';

describe('StatusLine', () => {
  it('renders success status in green', () => {
    const { lastFrame } = render(<StatusLine status="success" message="Created sandbox" />);
    expect(lastFrame()).toContain('Created sandbox');
  });

  it('renders error status in red', () => {
    const { lastFrame } = render(<StatusLine status="error" message="Failed to create" />);
    expect(lastFrame()).toContain('Failed to create');
  });

  it('renders info status', () => {
    const { lastFrame } = render(<StatusLine status="info" message="Sandbox running" />);
    expect(lastFrame()).toContain('Sandbox running');
  });
});
