# Resume Pro

A local-first macOS desktop app for AI-powered resume tailoring. Paste a job description, run the pipeline, and get a tailored resume exported as a polished PDF, all running on your machine, no cloud required.

## Download
[Resume Pro v1.2.0 — macOS (Apple Silicon)](https://github.com/kalyaan09/resumeBuilder/releases/tag/v0.1.0)

## Tech Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Desktop shell:** Tauri v2 (Rust)
- **Backend:** Python + FastAPI (sidecar on port 8000)
- **AI providers:** Google Gemini, Anthropic Claude, OpenAI, Groq, OpenRouter, Ollama (local)

## Features

- **4-agent LLM pipeline** — Planner → Navigator → Critic → Validator agents collaborate to tailor your resume to a job description
- **Multi-profile support** — maintain separate resumes for different roles or industries; switch profiles without losing your current draft
- **Section-level editing** — re-ask or reset any individual section after tailoring
- **JD analysis** — auto-detects company, seniority, company type, and keywords from the job description
- **PDF export** — Playwright-rendered PDF with font-size auto-fit, page overflow warnings, and export history
- **Native notifications** — OS alert when tailoring completes so you can step away
- **Export history** — every export is logged with company, role, score, and JD snippet
- **Persistent draft** — tailored resume survives tab navigation (Editor ↔ History ↔ Settings)
- **API keys stored encrypted** via `tauri-plugin-store`

## Getting Started

### Prerequisites

- Node.js 18+
- Rust + Tauri CLI (`cargo install tauri-cli`)
- Python 3.10+

### Install dependencies

```bash
# Frontend
npm install

# Python backend
cd python && pip install -r requirements.txt
```

### Run in development

```bash
# Terminal 1: start the Python sidecar
cd python && python3 main.py

# Terminal 2: start Tauri dev (frontend + shell)
npm run tauri dev
```

### Build the macOS DMG

```bash
./build-dmg.sh
```

This bundles the Python sidecar, compiles the Rust shell, ad-hoc signs all binaries, and produces a `.dmg` in `src-tauri/target/release/bundle/dmg/`. The app opens without any Gatekeeper warnings on the receiving machine.

> **Note:** The DMG is a binary artifact and is not committed to git. Rebuild locally with `./build-dmg.sh` whenever you need a fresh release.

### Installing the DMG

1. Open the DMG and drag **Resume Pro** to Applications
2. macOS will block the first launch with a security warning (the app isn't notarized). Run this once in Terminal:
   ```bash
   sudo xattr -rd com.apple.quarantine "/Applications/Resume Pro.app"
   ```
3. Open the app normally — no further steps needed

> This one command is the minimum friction for any unsigned macOS app distributed outside the App Store.

## Project Structure

```
src/              React + TypeScript frontend
src-tauri/        Tauri v2 Rust shell + capabilities
python/           FastAPI sidecar
  main.py         API entry point
  llm_client.py   Provider-agnostic LLM client
  pipeline/       4-agent tailoring pipeline
    planner.py
    navigator.py
    critic.py
    deterministic_validator.py
    controller.py
    utils.py
```

## Configuration

All configuration is managed through the app's Settings page:

- **AI Model** — pick provider + model, enter API key, test connection
- **Basic Info** — name, contact, shared resume data
- **Profiles** — per-role resume variants
- **Section order** — drag to reorder resume sections globally or per-profile

App data is stored in `~/.resume-editor/`.

### Clear all data (full reset)

To completely wipe the app back to first-launch state, delete all of the following:

```bash
rm -rf ~/.resume-editor/
rm -rf ~/Library/Application\ Support/com.resumepro/
rm -rf ~/Library/WebKit/com.resumepro/
rm -rf ~/Library/Caches/com.resumepro/
# Older builds used different bundle IDs — delete these too to be sure:
rm -rf ~/Library/Application\ Support/com.resumeeditor.app/
rm -rf ~/Library/WebKit/com.resumeeditor.app/
rm -rf ~/Library/WebKit/resume-editor/
```

- `~/.resume-editor/` — profile JSON files, `config.json`, `shared.json`
- `~/Library/WebKit/com.resumepro/` — **API key lives here** (in `localStorage` under `resume_editor_keys`)
- `~/Library/Application Support/com.resumepro/` — Tauri app data (would hold `keys.dat` if written)
- Older bundle dirs (`com.resumeeditor.app`, `resume-editor`) also contain `resume_editor_keys` from past sessions
