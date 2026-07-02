#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# install-macos.sh — build LabVAR and (re)install it as /Applications/LabVAR.app
#
# Compiles a release bundle, quits any running copy, replaces the app in
# /Applications with the freshly built one, and relaunches it. Because the app
# ships tauri-plugin-single-instance, a running copy is reused rather than
# duplicated — so after this runs you'll have exactly one LabVAR.
#
# Usage:  npm run deploy      (from the repo root)
#     or:  bash scripts/install-macos.sh
# ---------------------------------------------------------------------------
set -euo pipefail

APP_NAME="LabVAR"
DEST="/Applications/${APP_NAME}.app"

# Resolve repo root from this script's location, so it works from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT"

echo "▶ Building ${APP_NAME} (release, .app only)…"
# --bundles app: produce only the .app, skipping the flaky DMG (bundle_dmg.sh
# fails if a stale LabVAR volume is mounted, and we don't need a DMG to install).
npm run tauri build -- --bundles app

# Tauri emits the bundle here on macOS. Handle both arch-specific and default
# target dirs (e.g. when building on Apple Silicon with --target).
BUILT_APP=""
for candidate in \
  "src-tauri/target/release/bundle/macos/${APP_NAME}.app" \
  src-tauri/target/*/release/bundle/macos/${APP_NAME}.app; do
  if [ -d "$candidate" ]; then BUILT_APP="$candidate"; break; fi
done

if [ -z "$BUILT_APP" ]; then
  echo "✗ Could not find the built ${APP_NAME}.app under src-tauri/target/**/bundle/macos/." >&2
  echo "  Check the 'npm run tauri build' output above for errors." >&2
  exit 1
fi
echo "▶ Built: $BUILT_APP"

echo "▶ Quitting any running ${APP_NAME}…"
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
pkill -f "${APP_NAME}.app/Contents/MacOS/" 2>/dev/null || true
sleep 1

echo "▶ Replacing ${DEST}…"
if [ -w /Applications ] || [ -w "$DEST" ]; then
  rm -rf "$DEST"
  cp -R "$BUILT_APP" "$DEST"
else
  echo "  /Applications needs elevated permissions — using sudo."
  sudo rm -rf "$DEST"
  sudo cp -R "$BUILT_APP" "$DEST"
fi

echo "▶ Launching ${DEST}…"
open "$DEST"

echo "✓ ${APP_NAME} installed to ${DEST} and relaunched."
