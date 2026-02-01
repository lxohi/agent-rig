import { describe, it, expect } from 'vitest';
import { compareVersions, isNewerVersion, parseVersion } from './version.js';

describe('version', () => {
  describe('parseVersion', () => {
    it('parses version string', () => {
      const v = parseVersion('1.2.3');
      expect(v).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('handles v prefix', () => {
      const v = parseVersion('v1.2.3');
      expect(v).toEqual({ major: 1, minor: 2, patch: 3 });
    });
  });

  describe('compareVersions', () => {
    it('returns 1 when first is greater', () => {
      expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
      expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    });

    it('returns -1 when first is lesser', () => {
      expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
    });

    it('returns 0 when equal', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });
  });

  describe('isNewerVersion', () => {
    it('returns true when latest is newer', () => {
      expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true);
    });

    it('returns false when latest is same or older', () => {
      expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('1.0.0', '1.1.0')).toBe(false);
    });
  });
});
