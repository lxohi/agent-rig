import { describe, it, expect } from 'vitest';
import { processExists } from './process.js';

describe('process', () => {
  describe('processExists', () => {
    it('returns true for current process', () => {
      expect(processExists(process.pid)).toBe(true);
    });

    it('returns false for non-existent process', () => {
      expect(processExists(999999999)).toBe(false);
    });
  });
});
