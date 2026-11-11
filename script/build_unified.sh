#!/bin/bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$TASK_ROOT/script/toolchain.sh"
select_macos_sdk
export GPT_NIANG_BUILD_CONFIGURATION=release
/bin/bash "$TASK_ROOT/script/build_and_run.sh" --build-only
TASK_APP="$TASK_ROOT/dist/GPTNiangMac.app"
TASK_HELPER="$TASK_APP/Contents/Library/LoginItems/AICompanionLauncher.app"
mkdir -p "$TASK_HELPER/Contents/MacOS"
TASK_HELPER_BUILD="$(mktemp -d "${TMPDIR:-/tmp}/ai-pets-helper.XXXXXX")"
trap 'rm -rf "$TASK_HELPER_BUILD"' EXIT
TASK_HELPER_SLICES=()
for TASK_ARCH in $(/usr/bin/lipo -archs "$TASK_APP/Contents/MacOS/GPTNiangMac"); do
  TASK_SLICE="$TASK_HELPER_BUILD/AICompanionLauncher-$TASK_ARCH"
  /usr/bin/swiftc -O -sdk "$GPT_NIANG_SDK" -target "$TASK_ARCH-apple-macosx13.0" -module-cache-path "$TASK_ROOT/macos/.build-cache/clang" -parse-as-library "$TASK_ROOT/script/UnifiedLoginHelper.swift" -o "$TASK_SLICE"
  TASK_HELPER_SLICES+=("$TASK_SLICE")
done
if [ "${#TASK_HELPER_SLICES[@]}" -eq 1 ]; then
  cp "${TASK_HELPER_SLICES[0]}" "$TASK_HELPER/Contents/MacOS/AICompanionLauncher"
else
  /usr/bin/lipo -create "${TASK_HELPER_SLICES[@]}" -output "$TASK_HELPER/Contents/MacOS/AICompanionLauncher"
fi
TASK_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TASK_APP/Contents/Info.plist")"
cat > "$TASK_HELPER/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.github.t7moris.AICompanionLauncher</string>
<key>CFBundleExecutable</key><string>AICompanionLauncher</string>
<key>CFBundleName</key><string>AI额度挂件启动助手</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$TASK_VERSION</string>
<key>CFBundleVersion</key><string>$TASK_VERSION</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
PLIST
/usr/bin/plutil -insert AICompanionUnified -bool true "$TASK_APP/Contents/Info.plist"
/usr/bin/plutil -insert AICompanionRevision -string 'ai-quota-pets-0.1.0' "$TASK_APP/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleName -string 'AI额度挂件' "$TASK_APP/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleDisplayName -string 'AI额度挂件' "$TASK_APP/Contents/Info.plist"
cp "$TASK_ROOT/gpt-niang-usage/assets/gemini-original.png" "$TASK_ROOT/gpt-niang-usage/assets/gemini-quotes.json" "$TASK_APP/Contents/Resources/"
cp "$TASK_ROOT/gpt-niang-usage/assets/GEMINI-ASSET-LICENSE.md" "$TASK_APP/Contents/Resources/"
cp "$TASK_ROOT/gpt-niang-usage/assets/claude-original.png" "$TASK_ROOT/gpt-niang-usage/assets/CLAUDE-ARTWORK-LICENSE.txt" "$TASK_ROOT/gpt-niang-usage/assets/claude-quotes.json" "$TASK_ROOT/gpt-niang-usage/assets/deepseek-quotes.json" "$TASK_APP/Contents/Resources/"
cp "$TASK_ROOT/gpt-niang-usage/assets/DEEPSEEK-CODE-LICENSE.txt" "$TASK_ROOT/gpt-niang-usage/assets/CLAUDE-CODE-LICENSE.txt" "$TASK_ROOT/gpt-niang-usage/assets/GEMINI-HD-NOTICE.md" "$TASK_ROOT/gpt-niang-usage/assets/DEEPSEEK-ARTWORK-NOTICE.md" "$TASK_APP/Contents/Resources/"
cp -R "$TASK_ROOT/gpt-niang-usage/assets/ds-restored" "$TASK_APP/Contents/Resources/ds-restored"
cp "$TASK_ROOT/gpt-niang-usage/assets/claude-bust.png" "$TASK_APP/Contents/Resources/"
cp -R "$TASK_ROOT/gpt-niang-usage/assets/completion-smiles" "$TASK_APP/Contents/Resources/completion-smiles"
cp "$TASK_ROOT/gpt-niang-usage/assets/gemini-catgirl-hd.webp" "$TASK_ROOT/gpt-niang-usage/assets/deepseek-original.png" "$TASK_APP/Contents/Resources/"
cp -R "$TASK_ROOT/gpt-niang-usage/assets/click-expressions" "$TASK_APP/Contents/Resources/click-expressions"
/usr/bin/codesign --force --sign - "$TASK_HELPER"
/usr/bin/codesign --force --deep --sign - "$TASK_APP"
/usr/bin/codesign --verify --deep --strict "$TASK_APP"
echo "Built unified companion: $TASK_APP"
