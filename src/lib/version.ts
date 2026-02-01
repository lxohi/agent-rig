export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(version: string): Version {
  const cleaned = version.replace(/^v/, '');
  const [major, minor, patch] = cleaned.split('.').map(Number);
  return { major: major || 0, minor: minor || 0, patch: patch || 0 };
}

export function compareVersions(a: string, b: string): number {
  const vA = parseVersion(a);
  const vB = parseVersion(b);

  if (vA.major !== vB.major) return vA.major > vB.major ? 1 : -1;
  if (vA.minor !== vB.minor) return vA.minor > vB.minor ? 1 : -1;
  if (vA.patch !== vB.patch) return vA.patch > vB.patch ? 1 : -1;
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}
