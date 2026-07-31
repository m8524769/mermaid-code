#!/usr/bin/env bash
# Build MCP server binary and place it in src-tauri/binaries/ for local Tauri build

set -e

# Detect current platform and architecture
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Darwin)
    if [ "$ARCH" = "arm64" ]; then
      BUN_TARGET="bun-darwin-arm64"
      TAURI_TARGET="aarch64-apple-darwin"
    else
      BUN_TARGET="bun-darwin-x64"
      TAURI_TARGET="x86_64-apple-darwin"
    fi
    EXT=""
    ;;
  Linux)
    BUN_TARGET="bun-linux-x64"
    TAURI_TARGET="x86_64-unknown-linux-gnu"
    EXT=""
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    BUN_TARGET="bun-windows-x64"
    TAURI_TARGET="x86_64-pc-windows-msvc"
    EXT=".exe"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

OUTFILE="src-tauri/binaries/mermaid-code-mcp-${TAURI_TARGET}${EXT}"

echo "Building MCP server for $TAURI_TARGET..."

cd mcp-server
bun install --frozen-lockfile 2>/dev/null || bun install
bun build --compile --target="$BUN_TARGET" src/index.ts --outfile "../$OUTFILE"
cd ..

echo "MCP server binary built: $OUTFILE"
