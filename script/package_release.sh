#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$ROOT_DIR/script/build_unified.sh"
APP="$ROOT_DIR/dist/GPTNiangMac.app"
VERSION="$(cat "$ROOT_DIR/VERSION")"
ARCHIVE="ai-pets-v${VERSION}-macos-$(uname -m).zip"
bash "$ROOT_DIR/script/verify_app.sh" "$APP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ROOT_DIR/dist/$ARCHIVE"
cd "$ROOT_DIR/dist"
unzip -tq "$ARCHIVE"
shasum -a 256 "$ARCHIVE" > SHA256SUMS.txt
# Keep a verified archive, not another searchable development application.
# Explicit local debugging can opt in to retaining the uncompressed bundle.
if [ "${AI_PETS_KEEP_BUNDLE:-0}" != 1 ]; then
  TASK_LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  if [ -x "$TASK_LSREGISTER" ]; then
    "$TASK_LSREGISTER" -u "$APP" >/dev/null 2>&1 || true
  fi
  rm -rf "$APP"
fi
echo "Packaged: $ROOT_DIR/dist/$ARCHIVE"
