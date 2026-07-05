# PyInstaller spec for the Resume Editor Python sidecar.
# Run from the project root: env/bin/python -m PyInstaller python/resume-sidecar.spec --clean --noconfirm
#
# What gets bundled:
#   - FastAPI/uvicorn server (main.py + all local modules)
#   - Jinja2 HTML templates
#   - Playwright Python package + its Node.js driver
#
# --onedir mode: produces a directory (not a self-extracting binary).
# No extraction step on first launch — startup is instant from any launch.
# Output: python/dist/resume-sidecar/ (copied into src-tauri/resources/sidecar/ by build-dmg.sh)

import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_data_files
import certifi

block_cipher = None

# ── Playwright ────────────────────────────────────────────────────────────────
# collect_all picks up the playwright package + its Node.js driver binary.
# We use channel="chrome" at runtime so system Chrome is used — no need to
# bundle the Playwright-managed Chromium (~330MB saved from the DMG).
pw_datas, pw_binaries, pw_hiddenimports = collect_all("playwright")

# ── Analysis ──────────────────────────────────────────────────────────────────
a = Analysis(
    ["main.py"],
    pathex=[str(Path("python").resolve())],
    binaries=pw_binaries,
    datas=[
        # Jinja2 resume templates
        ("templates", "templates"),
        # SSL CA certificates for HTTPS requests (httpx / openai / anthropic)
        (certifi.where(), "certifi"),
    ] + pw_datas + collect_data_files("certifi"),
    hiddenimports=pw_hiddenimports + [
        # uvicorn dynamic imports
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.none",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        # Local sidecar modules
        "llm_client",
        "resume_extractor",
        "presets",
        "pdf_exporter",
        "docx_parser",
        "preview_templates",
        # Other deps
        "anthropic",
        "openai",
        "google.genai",
        "groq",
        "httpx",
        "httptools",
        "uvloop",
        "greenlet",
        "pypdf",
        "docx",
        "PIL",
        "PIL.Image",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "scipy"],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# --onedir: EXE contains only the bootloader + scripts; binaries/datas go in COLLECT.
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="resume-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="resume-sidecar",
)
