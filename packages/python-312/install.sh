#!/bin/bash
# Install Python 3.12 package via mise
set -e

echo "=== Installing Python 3.12 via mise ==="
mise use --global python@3.12

# Verify installation
python --version
pip --version

echo "=== Python 3.12 package installed ==="
