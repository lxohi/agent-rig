import { describe, it, expect } from 'vitest';
import { getBinaryName, getBinaryUrl, parseReleaseResponse } from './github-release.js';

describe('github-release', () => {
  describe('getBinaryName', () => {
    it('returns correct name for darwin arm64', () => {
      expect(getBinaryName('darwin', 'arm64')).toBe('arig-darwin-arm64');
    });

    it('returns correct name for linux x64', () => {
      expect(getBinaryName('linux', 'x64')).toBe('arig-linux-x64');
    });
  });

  describe('getBinaryUrl', () => {
    it('constructs correct download URL', () => {
      const url = getBinaryUrl('0.2.0', 'darwin', 'arm64');
      expect(url).toBe('https://github.com/lxohi/agent-rig/releases/download/v0.2.0/arig-darwin-arm64');
    });
  });

  describe('parseReleaseResponse', () => {
    it('extracts version from GitHub API response', () => {
      const response = { tag_name: 'v0.2.0', name: 'Release 0.2.0' };
      const version = parseReleaseResponse(response);
      expect(version).toBe('0.2.0');
    });

    it('handles version without v prefix', () => {
      const response = { tag_name: '0.2.0' };
      const version = parseReleaseResponse(response);
      expect(version).toBe('0.2.0');
    });
  });
});
