#!/usr/bin/env bash
# Sourced by both build entrypoints; preserve an explicitly selected SDK.
select_macos_sdk() {
  if [ -n "${GPT_NIANG_SDK:-}" ]; then
    if [ ! -d "$GPT_NIANG_SDK" ]; then
      echo "Selected SDK does not exist: $GPT_NIANG_SDK" >&2
      return 1
    fi
  else
    local developer_dir
    developer_dir="$(xcode-select -p)"
    # CLT's compiler cannot load the SwiftUI macro plugin from the 27 SDK.
    # Full Xcode supplies that plugin and should use its own selected SDK.
    if [[ "$developer_dir" == */CommandLineTools ]] && [ -d /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk ]; then
      GPT_NIANG_SDK=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
    else
      GPT_NIANG_SDK="$(xcrun --sdk macosx --show-sdk-path)"
    fi
  fi
  export GPT_NIANG_SDK
}
