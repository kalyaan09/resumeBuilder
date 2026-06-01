# PyInstaller spec for the Resume Editor Python sidecar.
# Run from the project root: env/bin/python -m PyInstaller python/resume-sidecar.spec --clean --noconfirm
#
# What gets bundled:
#   - FastAPI/uvicorn server (main.py + all local modules)
#   - Jinja2 HTML templates
#   - Playwright Python package + its Node.js driver
#   - Chromium browser from ~/Library/Caches/ms-playwright/
#
# The --onefile EXE extracts to ~/.resume-editor/_runtime/{hash}/ on first launch,
# then reuses the cached extraction on subsequent launches (fast after first run).

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

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="resume-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,           # Do NOT compress — would corrupt the Chromium binary
    upx_exclude=[],
    runtime_tmpdir=str(Path.home() / ".resume-editor" / "_runtime"),
    console=True,        # Keep console so log output goes to stderr (captured by Tauri)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
