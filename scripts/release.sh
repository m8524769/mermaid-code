#!/bin/sh
set -e

VERSION="$1"

if [ -z "$VERSION" ] || ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "Usage: pnpm release <version>  (e.g. pnpm release 0.1.9)"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required. Install it with:"
  echo "  macOS:  brew install jq"
  echo "  Ubuntu: sudo apt install jq"
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Error: tag v$VERSION already exists"
  exit 1
fi

# Update package.json
jq --arg v "$VERSION" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json
echo "✓ package.json → $VERSION"

# Update src-tauri/tauri.conf.json
jq --arg v "$VERSION" '.version = $v' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
echo "✓ src-tauri/tauri.conf.json → $VERSION"

# Update src-tauri/Cargo.toml
sed -i.bak "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
rm -f src-tauri/Cargo.toml.bak
echo "✓ src-tauri/Cargo.toml → $VERSION"

# Update Cargo.lock
(cd src-tauri && cargo update --package mermaid-code)
echo "✓ src-tauri/Cargo.lock updated"

# Git commit + tag + push
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: bump version to $VERSION"
git tag "v$VERSION"
git push
git push origin "v$VERSION"

echo "\nReleased v$VERSION"
