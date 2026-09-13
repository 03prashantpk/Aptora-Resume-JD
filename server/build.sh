#!/usr/bin/env bash
# Exit on error
set -e

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt

echo "=== Installing Tectonic Linux binary (musl static) ==="
BIN_DIR="$(pwd)/app/compiler/bin"
mkdir -p "$BIN_DIR"

# Download statically linked musl binary (no glibc version dependency)
echo "Downloading Tectonic 0.17.0 x86_64 musl static Linux release..."
curl -fsSL https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/tectonic-0.17.0-x86_64-unknown-linux-musl.tar.gz -o /tmp/tectonic.tar.gz
tar -xzf /tmp/tectonic.tar.gz -C "$BIN_DIR"
chmod +x "$BIN_DIR/tectonic"
rm -f /tmp/tectonic.tar.gz
echo "Tectonic musl installed successfully at $BIN_DIR/tectonic"

"$BIN_DIR/tectonic" --version
echo "=== Build complete ==="
