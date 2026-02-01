const REPO = 'lxohi/agent-rig';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

export function getBinaryName(os: string, arch: string): string {
  return `arig-${os}-${arch}`;
}

export function getBinaryUrl(version: string, os: string, arch: string): string {
  const binaryName = getBinaryName(os, arch);
  const tag = version.startsWith('v') ? version : `v${version}`;
  return `https://github.com/${REPO}/releases/download/${tag}/${binaryName}`;
}

export function parseReleaseResponse(response: { tag_name: string }): string {
  return response.tag_name.replace(/^v/, '');
}

export function getPlatform(): { os: string; arch: string } {
  const os = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return { os, arch };
}

export async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(API_URL, {
    headers: { 'User-Agent': 'arig-updater' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch latest version: ${response.status}`);
  }
  const data = await response.json() as { tag_name: string };
  return parseReleaseResponse(data);
}
