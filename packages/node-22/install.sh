#!/bin/bash
# Install Node.js 22 package via mise
set -e

echo "=== Installing Node.js 22 via mise ==="
mise use --global node@22

# Verify installation using mise exec
echo "=== Verifying Node.js 22 installation ==="
mise exec -- node --version
mise exec -- npm --version

echo "=== Node.js 22 package installed ==="
