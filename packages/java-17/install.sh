#!/bin/bash
# Install Java 17 package via mise
set -e

echo "=== Installing Java 17 via mise ==="
mise use --global java@temurin-17
mise use --global gradle@8.5
mise use --global maven@3.9.6

# Verify installation using mise exec
echo "=== Verifying Java 17 installation ==="
mise exec -- java -version
mise exec -- gradle --version
mise exec -- mvn --version

echo "=== Java 17 package installed ==="
