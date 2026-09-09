#!/usr/bin/env bash
set -euo pipefail

pnpm exec electron-builder --mac dir

app_path="release/mac-arm64/Fl Proyector.app"
if [[ ! -d "$app_path" ]]; then
  app_path="release/mac/Fl Proyector.app"
fi

codesign --force --deep --sign - --timestamp=none "$app_path"
codesign --verify --deep --strict "$app_path"
pnpm exec electron-builder --mac dmg --prepackaged "$app_path"
