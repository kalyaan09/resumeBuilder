#!/bin/bash
# build-dmg.sh — One command to build a distributable DMG for macOS.
#
# Usage:
#   chmod +x build-dmg.sh
#   ./build-dmg.sh
#
# Output:
#   src-tauri/target/release/bundle/dmg/Resume Pro_0.1.0_aarch64.dmg

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# Detect target triple for this machine
TARGET_TRIPLE="$(rustc -Vv | grep host | awk '{print $2}')"
echo "▶ Target: $TARGET_TRIPLE"

# ── Step 1: Build Python sidecar ─────────────────────────────────────────────
echo ""
echo "▶ Step 1/3 — Building Python sidecar with PyInstaller (--onedir)..."
echo "  Bundles the FastAPI server + Playwright driver into a directory."
echo "  No extraction on first launch — startup is instant."

# Create venv if it doesn't exist or if the interpreter is stale
if [ ! -f "python/env/bin/python" ] || ! python/env/bin/python --version &>/dev/null; then
  echo "  Creating Python virtual environment at python/env..."
  python3 -m venv python/env
  python/env/bin/pip install -r python/requirements.txt --quiet
fi
python/env/bin/pip install pyinstaller --quiet

cd python
"$PROJECT_ROOT/python/env/bin/python" -m PyInstaller resume-sidecar.spec \
    --clean \
    --noconfirm \
    --distpath "$PROJECT_ROOT/python/dist"
cd "$PROJECT_ROOT"

SIDECAR_DIR="$PROJECT_ROOT/python/dist/resume-sidecar"
SIDECAR_BIN="$SIDECAR_DIR/resume-sidecar"
if [ ! -d "$SIDECAR_DIR" ] || [ ! -f "$SIDECAR_BIN" ]; then
    echo "✗ PyInstaller failed — directory not found at $SIDECAR_DIR"
    exit 1
fi
echo "  ✓ Sidecar built ($(du -sh "$SIDECAR_DIR" | cut -f1))"

# ── Step 2: Sync sidecar directory into Tauri resources ──────────────────────
echo ""
echo "▶ Step 2/3 — Syncing sidecar into src-tauri/resources/sidecar/..."
RESOURCES_DEST="$PROJECT_ROOT/src-tauri/resources/sidecar"
rm -rf "$RESOURCES_DEST"
mkdir -p "$RESOURCES_DEST"
cp -r "$SIDECAR_DIR/." "$RESOURCES_DEST/"
chmod +x "$RESOURCES_DEST/resume-sidecar"
echo "  ✓ Synced to src-tauri/resources/sidecar/ ($(du -sh "$RESOURCES_DEST" | cut -f1))"

# ── Step 3: Build Tauri app ───────────────────────────────────────────────────
echo ""
echo "▶ Step 3/4 — Building Tauri app..."
npm run tauri build

# ── Step 4: Ad-hoc sign + repackage DMG ──────────────────────────────────────
# macOS Sonoma/Sequoia shows "damaged" for apps with unsigned binaries.
# Ad-hoc signing (-) satisfies Gatekeeper without a paid Apple Developer account.
echo ""
echo "▶ Step 4/4 — Ad-hoc signing app bundle..."
APP_BUNDLE=$(find src-tauri/target/release/bundle/macos -name "*.app" -type d | head -1)
if [ -z "$APP_BUNDLE" ]; then
    echo "✗ Could not find .app bundle to sign"
    exit 1
fi
codesign --force --deep --sign - "$APP_BUNDLE"
echo "  ✓ Ad-hoc signed: $APP_BUNDLE"

# Re-create the DMG from the signed .app so the signed version is what ships.
echo "  Re-packaging DMG..."
DMG_DIR="$PROJECT_ROOT/src-tauri/target/release/bundle/dmg"
EXISTING_DMG=$(find "$DMG_DIR" -name "*.dmg" | head -1)
if [ -n "$EXISTING_DMG" ]; then
    rm -f "$EXISTING_DMG"
fi
APP_NAME=$(basename "$APP_BUNDLE" .app)
hdiutil create \
    -volname "$APP_NAME" \
    -srcfolder "$APP_BUNDLE" \
    -ov -format UDZO \
    "$DMG_DIR/${APP_NAME}_${TARGET_TRIPLE}.dmg"

echo ""
echo "✓ Done! Your DMG is at:"
find "$DMG_DIR" -name "*.dmg" | head -1
echo ""
echo "Share that DMG — friends open it, drag to Applications, and it just works."
