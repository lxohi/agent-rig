#!/bin/bash
set -e

REPO="lxohi/agent-rig"
INSTALL_DIR="$HOME/.arig"

echo "Installing arig..."

# 1. Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "Error: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

if [ "$OS" != "darwin" ] && [ "$OS" != "linux" ]; then
  echo "Error: Unsupported OS: $OS"
  exit 1
fi

# 2. Get latest version from GitHub API
echo "Fetching latest version..."
VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)

if [ -z "$VERSION" ]; then
  echo "Error: Could not fetch latest version"
  exit 1
fi

VERSION_NUM="${VERSION#v}"

# 3. Download binary
BINARY="arig-${OS}-${ARCH}"
URL="https://github.com/$REPO/releases/download/${VERSION}/${BINARY}"

echo "Downloading $BINARY..."
mkdir -p "$INSTALL_DIR/versions/${VERSION_NUM}"
curl -fsSL "$URL" -o "$INSTALL_DIR/versions/${VERSION_NUM}/arig"
chmod +x "$INSTALL_DIR/versions/${VERSION_NUM}/arig"

# 4. Create symlink
mkdir -p "$INSTALL_DIR/bin"
ln -sf "../versions/${VERSION_NUM}/arig" "$INSTALL_DIR/bin/arig"

# 5. Initialize update.json
cat > "$INSTALL_DIR/update.json" << EOF
{
  "currentVersion": "${VERSION_NUM}",
  "lastCheck": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pendingVersion": null,
  "pendingPath": null,
  "downloadStarted": null,
  "downloadPid": null
}
EOF

# 6. Add to PATH (detect shell, modify rc file)
SHELL_NAME=$(basename "$SHELL")
case "$SHELL_NAME" in
  zsh)  RC_FILE="$HOME/.zshrc" ;;
  bash) RC_FILE="$HOME/.bashrc" ;;
  *)    RC_FILE="$HOME/.profile" ;;
esac

PATH_LINE='export PATH="$HOME/.arig/bin:$PATH"'
if ! grep -q '.arig/bin' "$RC_FILE" 2>/dev/null; then
  echo "" >> "$RC_FILE"
  echo "# arig" >> "$RC_FILE"
  echo "$PATH_LINE" >> "$RC_FILE"
fi

# 7. Print what was done
echo ""
echo "Installed arig ${VERSION} to $INSTALL_DIR"
echo ""
echo "Added to $RC_FILE:"
echo "  $PATH_LINE"
echo ""
echo "Restart your shell or run:"
echo "  source $RC_FILE"
echo ""
echo "Then run:"
echo "  arig --help"
