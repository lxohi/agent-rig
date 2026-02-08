import { describe, it, expect } from 'vitest';
import {
  TOOL_ALIASES,
  KNOWN_PACKAGES,
  resolveAlias,
  resolveAliases,
} from './tool-aliases.js';

describe('tool-aliases', () => {
  describe('resolveAlias', () => {
    it('resolves jvm17 to java-17', () => {
      expect(resolveAlias('jvm17')).toBe('java-17');
    });

    it('resolves jvm21 to java-21', () => {
      expect(resolveAlias('jvm21')).toBe('java-21');
    });

    it('resolves node22 to node-22', () => {
      expect(resolveAlias('node22')).toBe('node-22');
    });

    it('resolves node20 to node-20', () => {
      expect(resolveAlias('node20')).toBe('node-20');
    });

    it('resolves python312 to python-312', () => {
      expect(resolveAlias('python312')).toBe('python-312');
    });

    it('resolves py312 to python-312', () => {
      expect(resolveAlias('py312')).toBe('python-312');
    });

    it('returns canonical name unchanged', () => {
      expect(resolveAlias('java-17')).toBe('java-17');
    });

    it('returns unknown package name unchanged', () => {
      expect(resolveAlias('unknown-pkg')).toBe('unknown-pkg');
    });
  });

  describe('resolveAliases', () => {
    it('resolves all aliases in a list', () => {
      const result = resolveAliases(['jvm17', 'node22']);
      expect(result).toEqual(['java-17', 'node-22']);
    });

    it('deduplicates after resolution', () => {
      const result = resolveAliases(['python312', 'py312']);
      expect(result).toEqual(['python-312']);
    });

    it('handles mix of aliases and canonical names', () => {
      const result = resolveAliases(['jvm17', 'node-20', 'uv']);
      expect(result).toEqual(['java-17', 'node-20', 'uv']);
    });

    it('returns empty array for empty input', () => {
      const result = resolveAliases([]);
      expect(result).toEqual([]);
    });

    it('deduplicates alias and canonical for same package', () => {
      const result = resolveAliases(['node22', 'node-22']);
      expect(result).toEqual(['node-22']);
    });
  });

  describe('TOOL_ALIASES', () => {
    it('all alias targets are in KNOWN_PACKAGES', () => {
      for (const target of Object.values(TOOL_ALIASES)) {
        expect(KNOWN_PACKAGES).toContain(target);
      }
    });
  });

  describe('KNOWN_PACKAGES', () => {
    it('contains expected packages', () => {
      expect(KNOWN_PACKAGES).toContain('java-17');
      expect(KNOWN_PACKAGES).toContain('java-21');
      expect(KNOWN_PACKAGES).toContain('node-20');
      expect(KNOWN_PACKAGES).toContain('node-22');
      expect(KNOWN_PACKAGES).toContain('python-312');
      expect(KNOWN_PACKAGES).toContain('uv');
    });
  });
});
