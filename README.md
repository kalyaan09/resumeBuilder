# Resume Pro

A local-first macOS desktop app for AI-powered resume tailoring. Paste a job description, run the pipeline, and get a tailored resume exported as a polished PDF — all running on your machine, no cloud required.

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

This bundles the Python sidecar as a PyInstaller binary, compiles the Rust shell, and produces a `.dmg` in `src-tauri/target/release/bundle/dmg/`.

> **Note:** The DMG is a binary artifact and is not committed to git. Rebuild locally with `./build-dmg.sh` whenever you need a fresh release.

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
