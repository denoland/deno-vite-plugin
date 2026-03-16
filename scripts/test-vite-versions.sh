#!/usr/bin/env bash
# Test the plugin against multiple Vite versions.
# Usage: ./scripts/test-vite-versions.sh [versions...]
# Example: ./scripts/test-vite-versions.sh 5 6 7 8

set -euo pipefail

if [ $# -eq 0 ]; then
  VERSIONS=(5 6 7 8)
else
  VERSIONS=("$@")
fi

# Build first while node_modules is intact
npm run build

for version in "${VERSIONS[@]}"; do
  echo ""
  echo "=== Testing with Vite $version ==="
  rm -rf node_modules package-lock.json
  npm install "vite@$version" --no-save --force 2>&1 | tail -1
  installed=$(node -e "console.log(require('vite/package.json').version)")
  echo "Installed vite@$installed"
  npx vitest run
done

# Restore original state
echo ""
echo "=== Restoring original dependencies ==="
rm -rf node_modules package-lock.json
npm install 2>&1 | tail -1
echo "Done."
