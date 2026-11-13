#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/script/toolchain.sh"
select_macos_sdk
TASK_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/ai-pets-window-tests.XXXXXX")"
trap 'rm -rf "$TASK_TEMP"' EXIT
TASK_TEST_DIR="$TASK_TEMP/work.noindex"
mkdir -p "$TASK_TEST_DIR"
swiftc -O -parse-as-library -D WINDOW_LIFECYCLE_STANDALONE \
  -sdk "$GPT_NIANG_SDK" -target "$(uname -m)-apple-macosx13.0" \
  -module-cache-path "$TASK_TEST_DIR/clang" \
  "$ROOT_DIR/macos/Sources/GPTNiangMac/UtilityWindowCoordinator.swift" \
  "$ROOT_DIR/macos/Tests/GPTNiangMacTests/UtilityWindowCoordinatorTests.swift" \
  -o "$TASK_TEST_DIR/window-checks"
"$TASK_TEST_DIR/window-checks"
