#!/bin/bash
# Install Java 21 package via mise
set -e

echo "=== Installing Java 21 via mise ==="
mise use --global java@temurin-21
mise use --global gradle@8.5
mise use --global maven@3.9.6

# Verify installation
java -version
gradle --version
mvn --version

echo "=== Java 21 package installed ==="
