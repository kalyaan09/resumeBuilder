#!/bin/bash
# build-dmg.sh — One command to build a distributable DMG for macOS.
#
# Usage:
#   chmod +x build-dmg.sh
#   ./build-dmg.sh
#
# Output:
#   src-tauri/target/release/bundle/dmg/Resume Editor_0.1.0_aarch64.dmg

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# Detect target triple for this machine
TARGET_TRIPLE="$(rustc -Vv | grep host | awk '{print $2}')"
echo "▶ Target: $TARGET_TRIPLE"

# ── Step 1: Build Python sidecar ─────────────────────────────────────────────
echo ""
echo "▶ Step 1/3 — Building Python sidecar with PyInstaller..."
echo "  This bundles the FastAPI server + Playwright driver into one binary."
echo "  System Chrome is used at runtime — no Chromium bundled (DMG ~80MB)."

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

SIDECAR_BIN="$PROJECT_ROOT/python/dist/resume-sidecar"
if [ ! -f "$SIDECAR_BIN" ]; then
    echo "✗ PyInstaller failed — binary not found at $SIDECAR_BIN"
    exit 1
fi
echo "  ✓ Sidecar binary built ($(du -sh "$SIDECAR_BIN" | cut -f1))"

# ── Step 2: Copy sidecar into Tauri binaries directory ───────────────────────
echo ""
echo "▶ Step 2/3 — Copying sidecar binary to src-tauri/binaries/..."
mkdir -p src-tauri/binaries
DEST="$PROJECT_ROOT/src-tauri/binaries/resume-sidecar-${TARGET_TRIPLE}"
cp "$SIDECAR_BIN" "$DEST"
chmod +x "$DEST"
echo "  ✓ Copied to src-tauri/binaries/resume-sidecar-${TARGET_TRIPLE}"

# ── Step 3: Build Tauri app → DMG ────────────────────────────────────────────
echo ""
echo "▶ Step 3/3 — Building Tauri app (DMG)..."
npm run tauri build

echo ""
echo "✓ Done! Your DMG is at:"
find src-tauri/target/release/bundle/dmg -name "*.dmg" 2>/dev/null | head -1
echo ""
echo "Share that DMG file with your friends — they just open it and drag to Applications."
