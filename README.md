# Resume Builder

A local desktop app for AI-powered resume editing. Upload a `.docx` resume template, edit sections with AI assistance, and export a polished PDF — all running locally on your machine.

## Tech Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS
- **Desktop shell:** Tauri v2 (Rust)
- **Backend:** Python + FastAPI (sidecar)
- **AI providers:** OpenAI, Anthropic, Google Gemini

## Features

- Upload a `.docx` resume template — sections are detected dynamically
- AI rewrites individual sections based on your experience level
- Supports new grad (1-page) and mid/senior (2-page) formats
- PDF export via LibreOffice/docx2pdf (falls back to WeasyPrint for `.tex` templates)
- API keys stored encrypted via `tauri-plugin-store`

## Getting Started

### Prerequisites

- Node.js
- Rust + Tauri CLI (`cargo install tauri-cli`)
- Python 3.10+
- LibreOffice (for PDF export)

### Install dependencies

```bash
# Frontend
npm install

# Python backend
cd python && pip install -r requirements.txt
```

### Run in development

```bash
# Terminal 1 — start the Python sidecar
cd python && python3 main.py

# Terminal 2 — start the frontend
npm run dev
```

### Build for production

```bash
npm run tauri build
```

> The Python backend is bundled as a PyInstaller binary for production builds.

## Configuration

- API keys: stored encrypted in `tauri-plugin-store` (set via the Settings page)
- Template, save path, and instructions: stored in `localStorage`
