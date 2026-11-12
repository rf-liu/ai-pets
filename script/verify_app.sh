#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-$ROOT_DIR/dist/GPTNiangMac.app}"
MAIN="$APP/Contents/MacOS/GPTNiangMac"
HELPER="$APP/Contents/Library/LoginItems/AICompanionLauncher.app/Contents/MacOS/AICompanionLauncher"
codesign --verify --deep --strict "$APP"
if [ -n "$(find "$APP/Contents" -type f \( -name '*.bak' -o -name '*.old' \) -print -quit)" ]; then
  echo "Unexpected obsolete backup source in release" >&2
  exit 1
fi
if [ -e "$APP/Contents/Helpers/GPTNiangUpdater" ] || [ -e "$APP/Contents/Resources/Backend/runtime/update.mjs" ]; then
  echo "Unexpected updater in release" >&2
  exit 1
fi
for BINARY in "$MAIN" "$HELPER"; do
  if ! xcrun vtool -show-build "$BINARY" | awk '/minos/ { found=1; if ($2 != "13.0") bad=1 } END { exit bad || !found }'; then
    echo "Expected macOS 13.0 deployment target: $BINARY" >&2
    exit 1
  fi
done
if [ "$(lipo -archs "$MAIN")" != "$(lipo -archs "$HELPER")" ]; then
  echo "Application and login helper must contain the same architectures" >&2
  exit 1
fi
echo "Verified signature, deployment target, architectures and updater exclusion"
