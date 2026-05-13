# Resume Editor — Project Documentation

> Last updated: 2026-05-01

---

## 1. What Is This App?

**Resume Editor** is a local-first, AI-powered desktop app for macOS that lets you maintain one master resume and instantly tailor it to any job description using an LLM. You paste a job description, pick a template, and get a polished, one-page PDF ready to send — in under a minute.

The core promise: your resume data lives on your machine, API keys never leave your device, and the LLM does the heavy lifting of keyword matching, bullet rewriting, and section reordering without hallucinating skills you don't have.

---

## 2. Why We Built It

Job hunting is a repetitive, manual process. Tailoring a resume for each role means:
- Copying and pasting between a Word doc and a PDF template
- Manually weaving in keywords from the JD
- Re-exporting every time you tweak a font or reorder a section

Existing tools (Resumake, Reactive Resume, Kickresume) are web-based, store your data on their servers, and don't do intelligent tailoring — they're glorified form editors.

We wanted:
- **Full local data ownership** — no cloud, no signup
- **LLM tailoring** — not just templating, but actual rewriting guided by the job description
- **Multi-profile support** — a SWE resume and a Data Engineer resume from the same base data
- **Instant PDF preview** — see the exact PDF as you edit
- **Distributable offline binary** — share a DMG with anyone, no Python or Node install required

---

## 3. Tech Stack

### Frontend
| Layer | Technology |
|---|---|
| Desktop shell | **Tauri v2** (Rust, WKWebView on macOS) |
| UI framework | **React 18** + **TypeScript** |
| Build tool | **Vite 5** |
| Styling | **Tailwind CSS v3** (dark mode via `class` strategy) |
| Routing | **React Router v6** |
| Animations | **Framer Motion** |
| Icons | **Lucide React** |
| UI primitives | Custom: `Button`, `Surface`, `SegmentedControl`, `Modal`, `Typography` in `src/ui/` |
| Tauri plugins | `plugin-fs` (file I/O), `plugin-store` (encrypted key storage), `plugin-dialog` |
| Client-side ML | `@xenova/transformers` — WASM-based transformer for local JD keyword extraction |

### Backend (Python Sidecar)
| Layer | Technology |
|---|---|
| Web framework | **FastAPI** + **Uvicorn** |
| PDF generation | **Playwright** (`channel="chrome"` — uses system Chrome, no bundled Chromium) |
| HTML templating | **Jinja2** (4 resume templates) |
| Data validation | **Pydantic v2** |
| Resume extraction | **python-docx**, **pypdf** (file parsing) → LLM → JSON |
| LLM providers | **Anthropic** SDK, **OpenAI** SDK (also covers Groq/OpenRouter), **google-generativeai**, **Ollama** (raw HTTP) |
| Packaging | **PyInstaller** (`--onefile`, bundled into Tauri as an external binary) |

### Data Format
All resume data follows the **JSON Resume schema** — an open standard with fields: `basics`, `summary`, `experience`, `education`, `skills`, `projects`, `certifications`, `publications`, `awards`, `volunteer`, `languages`.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  macOS Desktop (Tauri v2)                                    │
│                                                             │
│  ┌─────────────────────────┐   ┌──────────────────────────┐│
│  │  React + TypeScript UI  │   │  Python FastAPI Sidecar  ││
│  │  (WKWebView)            │◄──►  (localhost:8000)         ││
│  │                         │   │                          ││
│  │  Pages:                 │   │  Endpoints:              ││
│  │  - Setup (onboarding)   │   │  /extract-resume         ││
│  │  - Editor (main view)   │   │  /edit-resume            ││
│  │  - Settings             │   │  /preview-pdf            ││
│  │                         │   │  /export-pdf             ││
│  │  State:                 │   │  /profiles  (CRUD)       ││
│  │  - sharedData           │   │  /shared    (CRUD)       ││
│  │  - profileResume        │   │  + more...               ││
│  │  - editedResume         │   │                          ││
│  └─────────────────────────┘   └──────────────────────────┘│
│                                          │                   │
│  ~/.resume-editor/                       │  LLM API (cloud) │
│  ├── config.json                         └──────────────────│
│  ├── shared.json  (basics + education)                      │
│  ├── profiles/                                              │
│  │   ├── default/resume.json                                │
│  │   └── {id}/resume.json    (max 3 profiles)               │
│  ├── preview.pdf                                            │
│  ├── history.json                                           │
│  └── previews/  (cached template thumbnail PDFs)            │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow for Tailoring a Resume

```
User pastes JD
     │
     ▼
Client-side JD analysis (jdAnalysis.ts / @xenova/transformers)
  - extractKeywords()
  - detectSeniority()
  - detectCompanyType()
  - detectBestProfile()  ← auto-switches active profile
     │
     ▼
POST /edit-resume
  body: { jd_text, profile_resume, basics (sharedData),
          user_instructions, llm_config, transformers_context }
     │
     ▼
Python: build_skill_allowlist()  ← flat list, protects hallucination
     │
Python: build_candidate_persona()
     │
Python: build_dynamic_prompt()
     │
LLMClient.complete(static_system_prompt, dynamic_prompt)
  (static prompt is cached by provider — Anthropic ephemeral cache,
   Gemini CacheManager, OpenAI automatic prefix caching)
     │
     ▼
validate_output()  ← post-generation safety pass
  - Strips any skill not in the original allowlist
  - Reverts unsafe verb upgrades (designed/architected/pioneered...)
     │
     ▼
{ resume: validatedJSON }  →  setEditedResume({ ...sharedData, ...resume })
     │
     ▼
Live PDF preview (debounced 500ms):
  POST /preview-pdf → Playwright → ~/.resume-editor/preview.pdf
  GET  /preview-pdf-file → served over HTTP
  <object data="http://localhost:8000/preview-pdf-file?v={ts}"> renders in WKWebView
```

### File Layout (Python)
```
python/
├── main.py            — FastAPI server, all route handlers, data dir management
├── llm_client.py      — LLMClient (Anthropic/OpenAI/Gemini/Ollama) + GeminiCacheManager
├── pdf_exporter.py    — Playwright PDF generation, Jinja2 render, template previews
├── resume_extractor.py — LLM-based extraction from .tex/.docx/.pdf bytes
├── presets.py         — role × seniority → template + section order presets
└── templates/         — Jinja2 HTML templates: jake, sb2nov, faangpath, myresume
```

### File Layout (Frontend)
```
src/
├── pages/
│   ├── Editor.tsx     — main editor: JD input, section editing, PDF preview, export
│   ├── Settings.tsx   — LLM config, template picker, theme, profile management
│   └── Setup.tsx      — first-run onboarding: resume upload + LLM key entry
├── components/
│   ├── ResumeEditor.tsx  — editable section grid
│   ├── SectionBlock.tsx  — individual section with diff highlighting
│   ├── ModelPicker.tsx   — LLM provider/model dropdown
│   └── AppSidebar.tsx    — navigation sidebar
├── context/
│   └── ProfilesContext.tsx — profiles list, activeProfileId, switchTo()
├── lib/
│   ├── persistenceStore.ts — read/write to ~/.resume-editor/ via Tauri FS (localStorage fallback)
│   ├── secureStore.ts      — API key CRUD via tauri-plugin-store (encrypted keys.dat)
│   ├── sidecarApi.ts       — typed fetch wrappers for all backend endpoints
│   ├── jdAnalysis.ts       — client-side JD parsing: keywords, seniority, company type
│   └── themeStore.ts       — applyTheme() for dark/light/system
└── ui/
    └── Button, Surface, SegmentedControl, Modal, Typography, errorFormat
```

---

## 5. Key Design Decisions

### Sidecar Architecture
Python runs as a separate process (`localhost:8000`), not in Rust. This was pragmatic — Python has mature LLM SDKs, Playwright, and PDF tooling. Tauri spawns the PyInstaller binary at app launch in production; in dev you run it manually.

### JSON Resume as the Intermediate Format
Rather than templating raw text, we extract the resume into structured JSON, edit that JSON with the LLM, and render it back to HTML/PDF. This gives us:
- Deterministic rendering across templates
- Easy section-by-section reset/diff
- Schema-validated LLM output

### Shared Data + Profile Split
`shared.json` holds `basics` (name, contact, links) and `education` — things that never change between job applications. `profiles/{id}/resume.json` holds everything role-specific. This means you can switch from your SWE profile to your Data Engineer profile without re-entering your contact info.

### LLM Prompt Caching
The 14-rule system prompt is static and long. We exploit provider-specific prefix caching (Anthropic `cache_control: ephemeral`, Gemini CacheManager, OpenAI automatic caching) to avoid re-tokenising it on every call. The dynamic part (your resume + JD) is always fresh.

### Skill Allowlist + Validation Pass
The LLM is instructed not to invent skills, but LLMs hallucinate. A post-generation `validate_output()` function enforces this: every skill in the output is cross-checked against a flat list built from the original resume. Any skill not in the allowlist is silently stripped. This is the hardest constraint in the whole system.

### PDF via Playwright + System Chrome
Weasyprint (pure Python) had layout bugs with complex CSS. Playwright with `channel="chrome"` uses the real Chrome rendering engine — identical to what you'd see in a browser. We use `channel="chrome"` instead of bundling Chromium to keep the DMG under 100MB.

---

## 6. What We Built — Feature Timeline

### Phase 1 — Foundation
- Tauri v2 app shell with React/TypeScript/Vite/Tailwind
- FastAPI sidecar: `/extract-resume` endpoint (upload .tex/.docx/.pdf → JSON)
- Basic editor page: display extracted JSON sections
- Single Jinja2 template (`jake`), Playwright PDF export

### Phase 2 — LLM Tailoring
- `/edit-resume` endpoint with full LLM pipeline
- 14-rule static system prompt (Google XYZ format, Harvard action verbs, no em dashes, no AI phrases)
- Skill allowlist validation pass
- Verb upgrade guard (prevent hallucinated seniority)
- Multiple LLM providers: Anthropic, OpenAI, Gemini, Groq, OpenRouter, Ollama

### Phase 3 — Templates + Preview
- 3 additional templates: `sb2nov`, `faangpath`, `myresume`
- Font size scaling via CSS `zoom`
- Live PDF preview panel (debounced Playwright render, served over HTTP)
- Template preview cards in Settings (cached PDFs, scaled thumbnails)
- `/validate-template` — LLM-assisted template + section order suggestion

### Phase 4 — Profile System
- `shared.json` + `profiles/{id}/resume.json` data layout
- Up to 3 profiles (create from a second resume file)
- Profile CRUD: `/profiles`, `/create-profile`, `/switch-profile`, `/profile/{id}`, `/delete/{id}`
- Auto-profile detection: client-side JD analysis (`@xenova/transformers` NLP) suggests best profile
- Migration: old `master_resume.json` → `profiles/default` on first server start

### Phase 5 — Polish + Distribution
- Glass/frosted UI (Tailwind backdrop-blur, surface layers)
- Full dark/light/system theme support
- `/export-pdf` history logging to `~/.resume-editor/history.json`
- `build-dmg.sh` — one-command DMG build (PyInstaller → copy binary → `tauri build`)
- Sidecar retry logic in `main.rs` — polls port 8000 for 5s, spawns again if unreachable
- Sidecar log: `~/.resume-editor/sidecar.log`
- Setup flow protection: "Extract & Continue" disabled until sidecar ready (60s retry window)

---

## 7. Issues Faced & How We Overcame Them

### Issue 1 — WKWebView Can't Display PDF Blob URLs
**Problem:** We initially tried `URL.createObjectURL(pdfBlob)` and put it in an `<iframe>`. WKWebView (Safari/WebKit) blocks `blob:` URLs for PDFs due to a security policy. The preview was blank.

**Solution:** Instead of serving the PDF as a blob, the Python sidecar writes it to a fixed path (`~/.resume-editor/preview.pdf`) and serves it over HTTP via a `/preview-pdf-file` endpoint with `Cache-Control: no-store`. The frontend uses `<object data="http://localhost:8000/preview-pdf-file?v={timestamp}">`. The `?v=` timestamp busts the HTTP cache on every re-render. WKWebView renders PDF over localhost HTTP without restriction.

---

### Issue 2 — `<img>` Tags Can't Load from localhost in WKWebView
**Problem:** Using `<img src="http://localhost:8000/some-image">` silently failed in WKWebView even though CORS was open. Cross-origin image loads are blocked differently than fetch calls.

**Solution:** Always go through `fetch()` → `.blob()` → `URL.createObjectURL()` → `<img src={blobUrl}>`. This works because fetch respects the CORS headers; the `<img>` tag's network layer does not.

---

### Issue 3 — Stale Python Bytecode Causes Silent Wrong-Code Execution
**Problem:** After editing a `.py` file and restarting uvicorn, the old logic kept running. Tracebacks showed current source line numbers but the executing code was clearly old. For example, a `meta` dict was missing a `"fontSize"` key that we had just added — because the `.pyc` in `__pycache__` was from before the change.

**Solution:** Before every server restart after a code change:
```bash
find python/ -name "__pycache__" -type d -exec rm -rf {} +
lsof -ti:8000 | xargs kill -9
```
The `__pycache__` directory caches compiled bytecode and is NOT always invalidated by timestamp (especially on fast edits or across mounts). Deleting it forces a clean recompile.

---

### Issue 4 — LLM Hallucinating Skills
**Problem:** The LLM would "enhance" a resume by adding skills the user never had (e.g., adding "Kubernetes" to someone whose resume only mentioned Docker). Instructions in the prompt alone were unreliable.

**Solution:** Two-layer defence:
1. **Prompt instruction** — "You must not invent skills. Only use skills from the provided skill list."
2. **Post-generation `validate_output()`** — builds a flat `allowlist` of every skill token in the original resume before sending to LLM. After LLM returns, every skill item in the output is checked against the allowlist with a 3-pass fuzzy match (substring both ways → strip parentheticals → punctuation-normalised). Any skill not passing all 3 passes is stripped and logged. This is deterministic and cannot be bypassed by the LLM.

---

### Issue 5 — Profile Switch Not Reloading Resume State
**Problem:** When the user switched profiles via the dropdown, the Editor kept showing the old profile's content. The LLM tailored the wrong resume.

**Root cause:** `switchTo(id)` in `ProfilesContext` only updated the context's `activeProfileId`. The Editor's `profileResume` state was loaded once on mount and never refreshed.

**Solution:** Every profile switch (manual dropdown OR auto-detection) must call BOTH:
1. `switchTo(id)` — updates context
2. `loadProfileData(id)` — reloads `profileResume` from disk, rebuilds `masterSections`, clears `editedResume` / `editedSections`

The `masterResume` (old merged single state) concept was completely removed and replaced with the `sharedData` + `profileResume` split to make this impossible to get wrong again.

---

### Issue 6 — Pydantic v2 Reserved Field Name
**Problem:** A model class had a field named `model_config`. Pydantic v2 reserves this name for its own class-level configuration namespace. Any attempt to use it as a regular field caused silent attribute errors.

**Solution:** Renamed the field to `llm_config` everywhere (model class, API route, frontend types, all call sites).

---

### Issue 7 — `maxHeight` Doesn't Propagate to Children with `height: 100%` in Flex
**Problem:** A modal with `maxHeight: "90vh"` contained an `<object height="100%">` for PDF display. The object rendered at 0 height.

**Root cause:** CSS `max-height` does not establish a definite height for the flex algorithm. Children with `height: 100%` compute their height relative to the parent's *definite* height, which `max-height` does not provide.

**Solution:** Use explicit `height: "90vh"` on the modal container instead of `maxHeight`. The child `<object height="100%">` then resolves correctly.

---

### Issue 8 — Bullet Points Invisible in PDF Templates
**Problem:** Four templates had `li { display: block }` in their CSS. `display: block` suppresses the `::marker` pseudo-element, so `list-style-type: disc` had no effect — bullets were invisible in the rendered PDF.

**Solution:** Changed to `li { display: list-item }` in all 4 templates. (`sb2nov` uses a CSS `::before` pseudo-element for custom bullets, so it was unaffected by this change.)

---

### Issue 9 — Unsigned Binary Blocked by macOS Gatekeeper
**Problem:** After sharing the DMG, the app would open but the sidecar never started — "Connecting to AI sidecar…" forever. macOS Gatekeeper blocked the PyInstaller binary because the DMG is unsigned (no Apple Developer certificate).

**Solution:** The quarantine attribute on downloaded binaries can be cleared manually:
```bash
xattr -cr "/Applications/Resume Editor.app"
```
macOS then shows a Privacy & Security prompt — click Allow, re-run the command if needed. Documented this as the standard first-launch fix for unsigned distribution.

---

### Issue 10 — `CommandReceiver` Type Doesn't Exist in tauri-plugin-shell v2
**Problem:** The Rust sidecar spawn code tried to type the receiver as `tauri_plugin_shell::process::CommandReceiver`. This caused `E0425` (cannot find type) at compile time.

**Solution:** `tauri-plugin-shell` v2 reuses Tauri's own async channel type. The correct type annotation is:
```rust
tauri::async_runtime::Receiver<tauri_plugin_shell::process::CommandEvent>
```

---

### Issue 11 — "No Master Resume Found" on Second Launch
**Problem:** After the first run in prod, on the second launch, the app showed the setup screen again even though setup had completed. `config.json` said `setupComplete: true` but the resume was `null`.

**Root cause:** `persistenceStore.ts` wrote to either Tauri FS or localStorage but not both. On second launch, Tauri FS was available, the file didn't exist (because it was only written to localStorage on the first run), and the store returned `null` without falling back.

**Solution:** Always write to both localStorage and Tauri FS. On read: try disk first, fall back to localStorage. This dual-write ensures the data is available regardless of which storage layer initialises first.

---

### Issue 12 — Gemini SDK Caching API Changed Between Versions
**Problem:** The `google-generativeai` Python SDK changed its caching API between minor versions, breaking `GeminiCacheManager`.

**Solution:** `llm_client.py` tries the old SDK's caching API (`google.generativeai`) first. If caching setup fails (any exception), it falls back to the new SDK (`google.generativeai` v2 path) without caching. The fallback is silent — the LLM still works, just without prefix cache savings. A module-level `GeminiCacheManager` singleton holds the cache handle for the 1-hour TTL.

---

## 8. Running the App

### Development Mode
```bash
# Terminal 1 — Python sidecar
find python/ -name "__pycache__" -type d -exec rm -rf {} +
lsof -ti:8000 | xargs kill -9 2>/dev/null
env/bin/python python/main.py

# Terminal 2 — Frontend
npm run dev
```

### Production Build (macOS DMG)
```bash
./build-dmg.sh
# Output: src-tauri/target/release/bundle/dmg/
```

Build steps inside `build-dmg.sh`:
1. PyInstaller bundles Python → `python/dist/resume-sidecar`
2. Binary copied to `src-tauri/binaries/resume-sidecar-aarch64-apple-darwin`
3. `npm run tauri build` compiles Rust + React → DMG

### Debug Logs
- Python server: `/tmp/resume_debug.log` (`tail -f /tmp/resume_debug.log`)
- Sidecar in production: `~/.resume-editor/sidecar.log` (`tail -f ~/.resume-editor/sidecar.log`)

---

## 9. Supported LLM Providers

| Provider | Notes |
|---|---|
| **Anthropic** (Claude) | `cache_control: ephemeral` on system prompt |
| **OpenAI** | Automatic prefix caching |
| **Groq** | Via OpenAI SDK (`base_url` override) |
| **OpenRouter** | Via OpenAI SDK (`base_url` override) |
| **Google Gemini** | `GeminiCacheManager` (1hr TTL), falls back to uncached |
| **Ollama** | Raw `requests.post` to `/api/chat` (not OpenAI SDK) |

Recommended model: `gemini-2.5-flash` (best speed/quality/cost balance). Fastest: `gemini-3.1-flash-lite-preview`.

---

## 10. Data Storage Summary

| File | Contents | Written by |
|---|---|---|
| `~/.resume-editor/config.json` | template, theme, model config, `activeProfile` | Frontend (persistenceStore) |
| `~/.resume-editor/shared.json` | `basics` + `education` | Frontend + Backend |
| `~/.resume-editor/profiles/{id}/resume.json` | `summary`, `experience`, `skills`, `projects`, etc. | Frontend + Backend |
| `~/.resume-editor/preview.pdf` | Last rendered live preview | Backend (Playwright) |
| `~/.resume-editor/history.json` | Export history: date, company, role, score, JD snippet | Backend (`/export-pdf`) |
| `~/.resume-editor/previews/` | Cached template thumbnail PDFs | Backend (startup) |
| `~/.resume-editor/_runtime/` | PyInstaller extraction cache (prod only) | PyInstaller |
| `~/.resume-editor/sidecar.log` | Sidecar stdout/stderr (prod only) | `main.rs` |
| `~/.claude/keys.dat` (Tauri Store) | Encrypted API keys | Frontend (secureStore) |
