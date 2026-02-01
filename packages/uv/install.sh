#!/bin/bash
# Install UV package via mise
set -e

echo "=== Installing UV via mise ==="
mise use --global uv@latest

# Verify installation
uv --version

echo "=== UV package installed ==="
