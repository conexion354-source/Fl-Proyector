#!/usr/bin/env bash
set -euo pipefail

pnpm exec electron-builder --mac dir

app_path="release/mac-arm64/Fl Proyector.app"
if [[ ! -d "$app_path" ]]; then
  app_path="release/mac/Fl Proyector.app"
fi

codesign --force --deep --sign - --timestamp=none "$app_path"
codesign --verify --deep --strict "$app_path"
# Empaquetar solamente después de firmar la aplicación.  Esto evita que el
# DMG distribuido contenga una app sin firma (macOS la muestra como dañada).
pnpm exec electron-builder --mac dmg zip --prepackaged "$app_path"
