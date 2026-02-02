import React from 'react';
import { render, Text, Box } from 'ink';
import { fetchLatestVersion } from '../lib/github-release.js';
import { isNewerVersion } from '../lib/version.js';
import { downloadUpdate } from '../lib/downloader.js';
import { StatusLine } from '../components/StatusLine.js';
import { Spinner } from '../components/Spinner.js';
import { VERSION } from '../version.js';

function CheckingUI({ message }: { message: string }) {
  return <Spinner message={message} />;
}

export async function updateCommand(): Promise<void> {
  const { rerender, unmount } = render(<CheckingUI message="Checking for updates..." />);

  try {
    const latestVersion = await fetchLatestVersion();

    if (isNewerVersion(latestVersion, VERSION)) {
      rerender(<CheckingUI message={`Downloading v${latestVersion}...`} />);

      const result = await downloadUpdate(latestVersion);
      unmount();

      if (result.success) {
        render(
          <Box flexDirection="column">
            <Text color="green">✓</Text>
            <Text> Downloaded v{latestVersion}</Text>
            <Text dimColor>  Restart arig to apply the update.</Text>
          </Box>
        );
      } else {
        render(
          <StatusLine status="error" message={`Download failed: ${result.error}`} />
        );
        process.exit(1);
      }
    } else {
      unmount();
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
