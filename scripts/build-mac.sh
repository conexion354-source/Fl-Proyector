#!/usr/bin/env bash
set -euo pipefail

pnpm exec electron-builder --mac dir --publish never

app_path="release/mac-arm64/Fl Proyector.app"
if [[ ! -d "$app_path" ]]; then
  app_path="release/mac/Fl Proyector.app"
fi

# electron-builder no genera app-update.yml en este flujo (app empaquetada
# aparte y firmada después): sin él la búsqueda de actualizaciones fallaba
# con "ENOENT … app-update.yml". Se agrega antes de firmar.
cat > "$app_path/Contents/Resources/app-update.yml" <<'YML'
provider: github
owner: conexion354-source
repo: Fl-Proyector
updaterCacheDirName: fl-proyector-updater
YML

codesign --force --deep --sign - --timestamp=none "$app_path"
codesign --verify --deep --strict "$app_path"
# Empaquetar solamente después de firmar la aplicación.  Esto evita que el
# DMG distribuido contenga una app sin firma (macOS la muestra como dañada).
pnpm exec electron-builder --mac dmg zip --prepackaged "$app_path" --publish never
