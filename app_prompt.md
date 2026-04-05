# Resume Editor App — Build This For Me

## What We're Building
A local desktop resume editor app. User pastes a Job Description, the app uses an AI model to edit their resume, user can tweak it in-app, then exports as PDF saved to a chosen path.

---

## Platform
- **Mac only for now** — target macOS 13+ (Ventura and above)
- Do NOT add any cross-platform abstractions yet
- Use macOS-specific paths (`/Users/...`)
- Assume Python sidecar runs on macOS

## Stack
- **Desktop:** Tauri v2 + React + TypeScript + Vite
- **AI Layer:** Python FastAPI sidecar (runs locally alongside Tauri)
- **Styling:** Tailwind CSS
- **PDF Export:** WeasyPrint (Python)
- **DOCX Parsing:** python-docx
- **LaTeX Parsing:** Pandoc (extract plain text from `.tex` files)
- **Output:** Always PDF regardless of input format

---

## Full Folder Structure

```
resume-editor/
├── src-tauri/
│   ├── src/main.rs
│   ├── tauri.conf.json
│   └── Cargo.toml
├── src/
│   ├── pages/
│   │   ├── Setup.tsx         # First-launch onboarding
│   │   ├── Editor.tsx        # Main resume editing page
│   │   └── Settings.tsx      # Model config + user prefs
│   ├── components/
│   │   ├── ResumeEditor.tsx  # Full resume editable view
│   │   ├── SectionBlock.tsx  # Individual editable section
│   │   └── ModelPicker.tsx   # Provider/model selector UI
│   ├── App.tsx
│   └── main.tsx
├── python/
│   ├── main.py               # FastAPI app entry
│   ├── llm_client.py         # Multi-provider LLM abstraction
│   ├── docx_parser.py        # Parse .docx template into sections
│   ├── pdf_exporter.py       # Export final resume to PDF
│   └── requirements.txt
├── package.json
└── README.md
```

---

## Onboarding Screen (Setup.tsx)
First time the app launches, show a setup screen with:
1. **User Instructions** — large textarea — how they like their resume written (tone, what to never cut, priorities)
2. **Template Resume** — file upload — accepts `.docx` or `.tex`
3. **Research File** — file upload (optional) — a text/doc file with background research about the user done by any LLM
4. **Default Save Path** — folder picker for where PDFs get saved
5. Save all this to a local config file using Tauri's store plugin. Once setup is complete, never show this screen again (unless user resets from Settings).

---

## Settings Screen (Settings.tsx)
### AI Model Configuration
Support these providers with a dropdown to switch between them:

| Provider | Notes |
|---|---|
| Ollama (Local) | Free, runs on device. User sets model name e.g. `gemma4:27b` and base URL `http://localhost:11434` |
| Google Gemini | Free tier. User pastes API key, picks model e.g. `gemini-2.0-flash` |
| Anthropic Claude | User pastes API key, picks model e.g. `claude-opus-4-20250514` |
| OpenAI | User pastes API key, picks model e.g. `gpt-4.1` |
| OpenRouter | One API key, user types any model string |
| Groq | Free tier, fast. User pastes API key, picks model e.g. `llama-3.3-70b-versatile` |

Store API keys securely using `tauri-plugin-store`. Never log or transmit keys anywhere except directly to the chosen provider.

Show a **"Test Connection"** button next to each provider's config. When clicked:
- Send a minimal test message: `"Reply with OK"` to the configured model
- Show inline feedback:
  - ✅ Green — "Connected! Model is responding"
  - ❌ Red — show the actual error (invalid API key, model not found, Ollama not running, etc.)
- For Ollama specifically, check if `http://localhost:11434` is reachable first and show: "Ollama is not running — start it with `ollama serve`" if it's down
- Do NOT let user proceed to the main app if no model is connected and tested

---

## Python Sidecar — llm_client.py
Build a single clean abstraction. Ollama, OpenRouter, and Groq are all OpenAI-compatible — reuse the same client, just swap `base_url` and `api_key`.

```python
class LLMClient:
    def __init__(self, provider: str, model: str, api_key: str = None, base_url: str = None):
        ...

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        # Route to correct provider
        # Ollama / OpenRouter / Groq → use openai client with custom base_url
        # Anthropic → use anthropic client
        # Gemini → use google-generativeai client
```

---

## Python Sidecar — main.py (FastAPI)
Expose these endpoints, called by the Tauri frontend via HTTP:

### POST /parse-resume
- Input: path to `.docx` or `.tex` file
- For `.docx` → parse with python-docx
- For `.tex` → extract plain text using Pandoc (`pandoc input.tex -t plain`)
- Output: JSON with resume sections (summary, experience, education, skills, etc.)
- Show a neutral info message to LaTeX users: "Your template formatting won't be preserved — output will be PDF"

### POST /edit-resume
- Input: JD text, resume sections JSON, user instructions, research file content, model config
- Output: edited resume sections JSON
- Use a detailed system prompt (see below)

### POST /export-pdf
- Input: resume sections JSON, save path, user's formatting preferences
- Output: saves PDF to disk, returns success + file path

---

## The AI System Prompt (use this in /edit-resume)
```
You are an expert resume writer and career coach with 15 years of experience helping candidates land jobs at top companies.

You will be given:
1. A job description
2. The user's current resume sections
3. The user's personal instructions and preferences
4. (Optional) Research notes about the user

Your job is to rewrite the resume to be perfectly tailored for this specific job description.

Rules:
- Never invent experience, skills, or credentials the user does not have
- Prioritize keywords and phrases from the JD naturally throughout
- Keep bullet points achievement-focused with metrics where possible
- Follow the user's personal instructions strictly
- Return ONLY valid JSON matching the exact input schema — no commentary, no markdown
- Every section must be present in output even if unchanged
```

---

## Editor Screen (Editor.tsx)
Main flow after user pastes JD and hits "Edit My Resume":
1. Show loading state while Python sidecar processes
2. Render the edited resume section by section using `SectionBlock.tsx`
3. Every section is **inline editable** — click to edit any bullet, heading, or text
4. **"Re-ask AI"** button per section — user can type feedback and regenerate just that section
5. **"Reset Section"** button — revert a section to original
6. Top right: **"Export PDF"** button → calls `/export-pdf` → saves to default path (or lets user pick a new path)
7. Show success toast with the file path when done

---

## Important Implementation Notes
- Python sidecar starts automatically when Tauri app launches (configure in tauri.conf.json as a sidecar)
- All API keys stored encrypted via tauri-plugin-store, passed to Python sidecar per-request, never stored in Python
- App should work fully offline if user picks Ollama
- Handle errors gracefully — if AI call fails, show error inline with a retry button
- Config/settings persisted in `~/.resume-editor/config.json`

---

## Distribution
- Build should produce a `.dmg` installer via `npm run tauri build`
- App should work without code signing for now (friends can right-click → Open)
- Each user manages their own API keys inside the app Settings screen

## Start Here
1. Scaffold the Tauri + React + Vite project
2. Set up Python FastAPI sidecar with a health check endpoint
3. Build the Setup screen with file uploads and config saving
4. Wire the frontend to call the sidecar health check on launch
5. Then proceed through the rest of the features

After each step, tell me what you built and what's next. Ask me if anything is unclear before starting. Let's build this.
