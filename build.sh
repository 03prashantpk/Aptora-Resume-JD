#!/usr/bin/env bash
# Root build script for Render deployment
set -e

echo "=== Building Aptora Python Compiler Engine on Render ==="
cd server
bash build.sh
echo "=== Root build finished ==="
