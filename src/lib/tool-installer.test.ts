import { describe, it, expect } from 'vitest';
import { validatePackages, detectConflicts } from './tool-installer.js';

describe('tool-installer', () => {
  describe('validatePackages()', () => {
    it('resolves aliases and returns canonical names', () => {
      const result = validatePackages(['jvm17', 'node22']);
      expect(result).toEqual(['java-17', 'node-22']);
    });

    it('passes through canonical names unchanged', () => {
      const result = validatePackages(['java-17', 'node-22']);
      expect(result).toEqual(['java-17', 'node-22']);
    });

    it('throws for unknown packages', () => {
      expect(() => validatePackages(['unknown-tool'])).toThrow('Unknown packages: unknown-tool');
    });

    it('throws listing all unknown packages', () => {
      expect(() => validatePackages(['foo', 'bar'])).toThrow('Unknown packages: foo, bar');
    });

    it('accepts all known packages', () => {
      const result = validatePackages(['java-17', 'java-21', 'node-20', 'node-22', 'python-312', 'uv']);
      expect(result).toHaveLength(6);
    });
  });

  describe('detectConflicts()', () => {
    it('returns empty array when no conflicts', () => {
      expect(detectConflicts(['java-17', 'node-22'])).toEqual([]);
    });

    it('detects conflicting Java versions', () => {
      const conflicts = detectConflicts(['java-17', 'java-21']);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toContain('java-17');
      expect(conflicts[0]).toContain('java-21');
    });

    it('no conflict for single Java version', () => {
      expect(detectConflicts(['java-17', 'node-22'])).toEqual([]);
    });
  });
});
