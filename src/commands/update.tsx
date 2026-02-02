import React from 'react';
import { render, Text, Box } from 'ink';
import { fetchLatestVersion } from '../lib/github-release.js';
import { isNewerVersion } from '../lib/version.js';
import { spawnBackgroundDownloader } from '../lib/downloader.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';
import { VERSION } from '../version.js';

function CheckingUI() {
  return (
    <Box>
      <Spinner />
      <Text> Checking for updates...</Text>
    </Box>
  );
}

export async function updateCommand(): Promise<void> {
  const { unmount } = render(<CheckingUI />);

  try {
    const latestVersion = await fetchLatestVersion();
    unmount();

    if (isNewerVersion(latestVersion, VERSION)) {
      render(
        <Box flexDirection="column" gap={1}>
          <Text>
            <Text color="yellow">Update available:</Text> v{VERSION} → v{latestVersion}
          </Text>
          <Text dimColor>Downloading in background. Restart arig to apply.</Text>
        </Box>
      );
      // Trigger background download
      spawnBackgroundDownloader();
    } else {
      render(
        <StatusLine status="success" message={`Already up to date (v${VERSION})`} />
      );
    }
  } catch (error) {
    unmount();
    render(
      <StatusLine status="error" message={`Failed to check for updates: ${error}`} />
    );
    process.exit(1);
  }
}
