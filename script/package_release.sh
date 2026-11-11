#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$ROOT_DIR/script/build_unified.sh"
APP="$ROOT_DIR/dist/GPTNiangMac.app"
VERSION="$(cat "$ROOT_DIR/VERSION")"
ARCHIVE="AI-ZhuoChong-v${VERSION}-macos-$(uname -m).zip"
codesign --verify --deep --strict "$APP"
if [ -e "$APP/Contents/Helpers/GPTNiangUpdater" ]; then
  echo "Unexpected updater helper in release" >&2
  exit 1
fi
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ROOT_DIR/dist/$ARCHIVE"
cd "$ROOT_DIR/dist"
unzip -tq "$ARCHIVE"
shasum -a 256 "$ARCHIVE" > SHA256SUMS.txt
echo "Packaged: $ROOT_DIR/dist/$ARCHIVE"
