# New Architecture — Resume Editor App

## Context
We are scrapping the old LaTeX parsing and find/replace approach entirely. It was fragile, template-specific, and kept breaking. We are rebuilding the core pipeline with a clean, scalable architecture. Keep all existing UI components, multi-model llm_client.py, connection testing, and Tauri setup. Rebuild everything related to resume parsing, template rendering, and PDF export.

---

## Core Architecture Shift

### Old (scrapped):
```
User template → parse → LLM edits → find/replace back → pdflatex → PDF
```

### New:
```
User resume (any format) → extract to JSON → LLM edits JSON → 
render into our HTML/CSS template → Puppeteer → PDF
```

---

## Data Model — JSON Resume Schema

Use this as the master data structure for every resume:

```json
{
  "basics": {
    "name": "",
    "email": "",
    "phone": "",
    "location": "",
    "linkedin": "",
    "github": "",
    "portfolio": ""
  },
  "summary": "",
  "experience": [
    {
      "company": "",
      "title": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "bullets": []
    }
  ],
  "education": [
    {
      "institution": "",
      "degree": "",
      "field": "",
      "startDate": "",
      "endDate": "",
      "gpa": "",
      "honors": []
    }
  ],
  "skills": [
    {
      "category": "",
      "items": []
    }
  ],
  "projects": [
    {
      "name": "",
      "startDate": "",
      "endDate": "",
      "bullets": [],
      "link": ""
    }
  ],
  "certifications": [
    {
      "name": "",
      "issuer": "",
      "date": ""
    }
  ],
  "publications": [
    {
      "title": "",
      "journal": "",
      "date": "",
      "link": ""
    }
  ],
  "awards": [],
  "volunteer": [],
  "languages": []
}
```

Plus metadata stored separately:
```json
{
  "template": "jake",
  "role": "SDE",
  "level": "entry",
  "pages": 1,
  "activeSections": ["education", "skills", "projects", "experience"],
  "sectionOrder": ["education", "skills", "projects", "experience"]
}
```

---

## Templates

We have 4 LaTeX templates in `/Users/kalyaankanugula/Documents/res_app/template`:
- `myresume.tex`
- `faangpath.tex`
- `jake.tex`
- `sb2nov.tex`

Convert ALL 4 to HTML/CSS templates that:
- Match the visual style of each LaTeX original exactly
- Are black and white, clean, minimal
- Use section divider lines under each section header
- Use fonts: Calibri or Arial, 10-11pt body
- Margins: 0.5" to 0.75"
- Are single column
- Have no images, skill bars, or decorative elements
- All text is selectable (ATS safe)
- Contact info always in document body, never in header/footer

Each HTML template receives the JSON Resume data and renders it. Sections are shown/hidden and ordered based on `activeSections` and `sectionOrder` from metadata.

---

## Role × Level Presets (Lookup Table)

Build a lookup table in Python that maps role + level to a suggested template + section config:

```python
PRESETS = {
  ("SDE", "entry"): {
    "template": "jake",
    "sections": ["education", "skills", "projects", "experience"],
    "sectionOrder": ["education", "skills", "projects", "experience"]
  },
  ("SDE", "junior"): {
    "template": "jake",
    "sections": ["skills", "experience", "projects", "education"],
    "sectionOrder": ["skills", "experience", "projects", "education"]
  },
  ("SDE", "mid"): {
    "template": "jake",
    "sections": ["summary", "experience", "skills", "education"],
    "sectionOrder": ["summary", "experience", "skills", "education"]
  },
  ("DE", "entry"): {
    "template": "sb2nov",
    "sections": ["education", "skills", "projects", "experience"],
    "sectionOrder": ["education", "skills", "projects", "experience"]
  },
  ("ML", "entry"): {
    "template": "sb2nov",
    "sections": ["education", "skills", "projects", "experience", "publications"],
    "sectionOrder": ["education", "skills", "projects", "experience", "publications"]
  },
  ("PM", "entry"): {
    "template": "faangpath",
    "sections": ["summary", "experience", "skills", "education", "certifications"],
    "sectionOrder": ["summary", "experience", "skills", "education", "certifications"]
  },
  ("BA", "entry"): {
    "template": "faangpath",
    "sections": ["summary", "experience", "skills", "education", "certifications"],
    "sectionOrder": ["summary", "experience", "skills", "education", "certifications"]
  },
  ("TPM", "mid"): {
    "template": "faangpath",
    "sections": ["summary", "experience", "skills", "certifications", "education"],
    "sectionOrder": ["summary", "experience", "skills", "certifications", "education"]
  }
  # Add more combinations as needed
}
```

---

## Onboarding Flow

### Step 1 — User Input Screen
Collect:
- Full name, email, phone, location, LinkedIn, GitHub (optional), portfolio (optional)
- Role (dropdown: SDE, DE, ML Engineer, PM, BA, TPM, DevOps, Data Scientist, Data Analyst, Other)
- Level (dropdown: New Grad, Junior 1-2yr, Mid 2-4yr)
- Upload resume (.tex, .docx, or PDF)

### Step 2 — Extract Resume Content
Call `/extract-resume` endpoint:
- Input: uploaded resume file
- Use LLM to extract content into JSON Resume schema
- Return JSON

### Step 3 — Template Suggestion
1. Look up role + level in PRESETS table → get suggested template + sections
2. Call `/validate-template` endpoint — send to LLM:
   - Role, level, suggested template, suggested sections
   - LLM returns: `{"approved": true}` OR `{"approved": false, "template": "jake", "sections": [...], "reason": "..."}`
3. Show user:
```
┌─────────────────────────────────────────┐
│  We suggest this template               │
│                                         │
│  Template: Jake's Resume                │
│                                         │
│  Sections:                              │
│  1. Education                           │
│  2. Skills                              │
│  3. Projects                            │
│  4. Experience                          │
│                                         │
│  Why: Best for entry level SDE roles,   │
│  ATS friendly, projects-first layout    │
│                                         │
│  [Looks good!]        [Change it]       │
└─────────────────────────────────────────┘
```

### Step 4 — User Feedback Loop (if "Change it")
Show:
- List of current sections with [edit name] [remove] buttons
- [+ Add section] button
- Free text feedback box
- [Submit to AI] button

Track back-and-forth count:
- 1-4 times: no warning
- 5 times: 🟡 yellow warning "You've gone back and forth 5 times — each request uses your API tokens"
- 6-9 times: 🟠 warning gets stronger each time
- 10 times: 🔴 "This is getting expensive. Estimated tokens used: X. Are you sure you want to continue?"

Loop until user clicks "Looks good!"

### Step 5 — Render and Review
1. Render extracted JSON into chosen template
2. Show in editor UI (same editor component used for job applications)
3. User can edit any field directly
4. User clicks "Save Master Resume"
5. Save JSON + metadata to `~/.resume-editor/master_resume.json` and `~/.resume-editor/config.json`

---

## Per Job Application Flow

### Endpoint: POST /edit-resume
Input:
```json
{
  "jd_text": "full job description",
  "master_resume": { ...JSON Resume... },
  "user_instructions": "...",
  "research_text": "...",
  "llm_config": { ... }
}
```

System prompt:
```
You are an expert resume writer with 15 years experience helping candidates 
land jobs at top companies.

You will receive:
1. A job description
2. A master resume in JSON format
3. User instructions and preferences
4. Optional research notes

Your job is to tailor the resume content for this specific job description.

STRICT RULES:
- Return EXACT same JSON structure — same keys, same types, same number of items
- Never add or remove bullet points
- Never invent experience, skills, or credentials that don't exist
- Only rewrite existing text content
- Prioritize keywords from the JD naturally
- Keep bullets achievement-focused with metrics
- Plain text only — no markdown, no special characters
- Return valid JSON only, no commentary
```

Output: edited JSON Resume

### Frontend Flow:
1. User pastes JD
2. Call `/edit-resume`
3. Show edited resume in editor UI
4. User can edit any section
5. Export PDF button → call `/export-pdf`

---

## Master Resume Evolution (Settings)

### Adding a new section:
1. User goes to Settings → Edit Resume
2. Clicks "+ Add Section"
3. Picks section type or creates custom
4. Enters content
5. Clicks "Save & Sync"
6. Call `/validate-section-add`:
   - LLM gets: full master resume + new section + role + level
   - LLM returns: where to place it + any content suggestions
7. Show suggestion to user
8. User accepts/ignores
9. Save updated master resume

### Editing existing content:
1. User edits freely in editor
2. App tracks all changes (diff)
3. User clicks "Save & Sync"
4. Call `/sync-master-resume`:
   - LLM gets: full resume before + full resume after + diff + role + level
   - LLM checks: section structure AND content quality
   - Returns: list of suggestions (accept/ignore each)
5. User reviews suggestions
6. Save final master resume

---

## PDF Export

### Replace pdflatex with Puppeteer:
- Install Puppeteer in the Python sidecar OR use a Node.js script called from Tauri
- Render HTML template with resume JSON
- Puppeteer prints to PDF
- Save to user's chosen output path
- Reveal in Finder

### PDF settings:
```javascript
{
  format: 'A4',
  printBackground: true,
  margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' }
}
```

---

## New Endpoints Needed

| Endpoint | Purpose |
|---|---|
| `POST /extract-resume` | Extract any resume file to JSON Resume schema |
| `POST /validate-template` | LLM validates lookup table suggestion |
| `POST /edit-resume` | LLM tailors master resume JSON for a JD |
| `POST /validate-section-add` | LLM validates adding a new section |
| `POST /sync-master-resume` | LLM checks full resume after user edits |
| `POST /export-pdf` | Render JSON into HTML template → Puppeteer → PDF |

---

## Storage
All stored locally at `~/.resume-editor/`:
```
~/.resume-editor/
├── config.json          ← API keys, model config, template choice
├── master_resume.json   ← JSON Resume data
├── metadata.json        ← role, level, template, section order
└── exports/             ← exported PDFs
```

---

## What To Keep From Current Codebase
- ✅ All UI components (editor, settings, model picker, setup screens)
- ✅ `llm_client.py` — multi-model support
- ✅ Connection testing logic
- ✅ Tauri setup, plugins, file system access
- ✅ Reveal in Finder feature

## What To Rebuild
- 🔄 `pdf_exporter.py` → new Puppeteer-based export
- 🔄 `docx_parser.py` → new LLM-based JSON extractor
- 🔄 `main.py` → new endpoints as listed above
- 🔄 Template files → convert LaTeX to HTML/CSS

---

## Build Order
1. Convert 4 LaTeX templates to HTML/CSS
2. Build `/extract-resume` endpoint
3. Build onboarding flow with template suggestion + feedback loop
4. Build `/edit-resume` endpoint with new JSON approach
5. Build Puppeteer PDF export
6. Build Settings → Edit Resume → Save & Sync flow
7. Wire everything together and test end to end
