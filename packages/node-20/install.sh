#!/bin/bash
# Install Node.js 20 package via mise
set -e

echo "=== Installing Node.js 20 via mise ==="
mise use --global node@20

# Verify installation using mise exec
echo "=== Verifying Node.js 20 installation ==="
mise exec -- node --version
mise exec -- npm --version

echo "=== Node.js 20 package installed ==="
