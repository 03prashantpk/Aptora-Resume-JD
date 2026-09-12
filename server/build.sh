#!/usr/bin/env bash
# Exit on error
set -e

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt

echo "=== Installing Tectonic Linux binary if not present ==="
BIN_DIR="$(pwd)/app/compiler/bin"
mkdir -p "$BIN_DIR"

if [ ! -f "$BIN_DIR/tectonic" ]; then
    echo "Downloading Tectonic 0.17.0 x86_64 Linux release..."
    curl -fsSL https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/tectonic-0.17.0-x86_64-unknown-linux-gnu.tar.gz -o /tmp/tectonic.tar.gz
    tar -xzf /tmp/tectonic.tar.gz -C "$BIN_DIR"
    chmod +x "$BIN_DIR/tectonic"
    rm /tmp/tectonic.tar.gz
    echo "Tectonic installed successfully at $BIN_DIR/tectonic"
fi

"$BIN_DIR/tectonic" --version
echo "=== Build complete ==="
