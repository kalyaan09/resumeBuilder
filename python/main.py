import sys
import os

import logging
from pathlib import Path

_LOG_DIR = Path.home() / ".resume-editor"
_LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = str(_LOG_DIR / "sidecar.log")

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8"),
        logging.StreamHandler(sys.stderr),
    ],
)
log = logging.getLogger("resume")

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from typing import Optional, Any
from contextlib import asynccontextmanager
import asyncio
import uvicorn
import json
import re
import base64
import shutil
from pathlib import Path
from datetime import datetime

from llm_client import LLMClient
from pdf_exporter import export_to_pdf, render_preview_pdf_to_path, render_html, render_pdf_to_path
from resume_extractor import extract_resume_to_json
from presets import get_preset
from pipeline.controller import run_pipeline, analyze_critic_patterns

_VALID_TEMPLATES = {"jake", "faangpath", "sb2nov", "myresume"}

PREVIEW_VERSION = 8

# ── Data directory layout ──────────────────────────────────────────────────────
#
#  ~/.resume-editor/
#  ├── config.json         ← app config (template, theme, model, activeProfile)
#  ├── shared.json         ← basics + education (shared across ALL profiles)
#  ├── profiles/
#  │   └── default/
#  │       └── resume.json ← summary, experience, skills, projects, …
#  └── previews/           ← cached template preview PDFs
#
DATA_DIR = Path.home() / ".resume-editor"
SHARED_PATH = DATA_DIR / "shared.json"
PROFILES_DIR = DATA_DIR / "profiles"
CONFIG_PATH_DATA = DATA_DIR / "config.json"
OLD_RESUME_PATH = DATA_DIR / "master_resume.json"   # pre-migration path

# Keys that live in shared.json; everything else lives in the profile file.
_SHARED_KEYS = {"basics", "education"}

# Store generated previews in user data dir (works in both dev and frozen mode)
PREVIEWS_DIR = DATA_DIR / "previews"
PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)
_VERSION_FILE = PREVIEWS_DIR / "version.txt"


# ── Data helpers ──────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """
    Convert a profile name to a kebab-case slug used as the directory name.

    Examples:
      'Data Engineer'   → 'data-engineer'
      'AI Engineer'     → 'ai-engineer'
      'Backend Engineer'→ 'backend-engineer'
      'AI/ML'           → 'aiml'
    """
    # Replace non-alphanumeric characters (except spaces) with nothing, collapse spaces to hyphens
    cleaned = re.sub(r"[^a-zA-Z0-9 ]", "", name).strip()
    slug = re.sub(r"\s+", "-", cleaned).lower()
    return slug or "profile"


def _unique_id(base_id: str, existing_ids: list[str]) -> str:
    if base_id not in existing_ids:
        return base_id
    for i in range(2, 20):
        candidate = f"{base_id}{i}"
        if candidate not in existing_ids:
            return candidate
    return f"{base_id}_{len(existing_ids)}"


def _load_config() -> dict:
    if CONFIG_PATH_DATA.exists():
        try:
            with open(CONFIG_PATH_DATA) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_config(data: dict) -> None:
    CONFIG_PATH_DATA.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH_DATA, "w") as f:
        json.dump(data, f, indent=2)


def _load_shared() -> dict:
    if SHARED_PATH.exists():
        try:
            with open(SHARED_PATH) as f:
                return json.load(f)
        except Exception:
            pass
    return {"basics": {}, "education": []}


def _save_shared(data: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(SHARED_PATH, "w") as f:
        json.dump(data, f, indent=2)


def _load_profile(profile_id: str) -> dict:
    path = PROFILES_DIR / profile_id / "resume.json"
    if path.exists():
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_profile(profile_id: str, data: dict) -> None:
    profile_dir = PROFILES_DIR / profile_id
    profile_dir.mkdir(parents=True, exist_ok=True)
    with open(profile_dir / "resume.json", "w") as f:
        json.dump(data, f, indent=2)


def _get_full_resume(profile_id: str) -> dict:
    """Return shared.json merged with profile resume.json (shared wins for basics/education)."""
    shared = _load_shared()
    profile = _load_profile(profile_id)
    return {**profile, **shared}


def _list_profile_ids() -> list[str]:
    if not PROFILES_DIR.exists():
        return []
    ids = []
    for d in sorted(PROFILES_DIR.iterdir()):
        if d.is_dir() and (d / "resume.json").exists():
            ids.append(d.name)
    return ids


def _migrate_if_needed() -> None:
    """
    If old master_resume.json exists and no profiles directory has been created yet,
    split it into shared.json (basics + education) and profiles/default/resume.json.
    """
    if not OLD_RESUME_PATH.exists():
        return

    existing_ids = _list_profile_ids()
    if existing_ids:
        # Migration already completed; just clean up the old file.
        OLD_RESUME_PATH.unlink(missing_ok=True)
        log.info("[migration] master_resume.json found but profiles already exist; removing old file")
        return

    log.info("[migration] migrating master_resume.json → profiles/default + shared.json")
    try:
        with open(OLD_RESUME_PATH) as f:
            old_resume = json.load(f)
    except Exception as e:
        log.error("[migration] failed to read master_resume.json: %s", e)
        return

    # Write shared.json
    shared = {
        "basics": old_resume.get("basics", {}),
        "education": old_resume.get("education", []),
    }
    _save_shared(shared)

    # Write profiles/default/resume.json
    profile_data = {k: v for k, v in old_resume.items() if k not in _SHARED_KEYS}
    profile_data["id"] = "default"
    profile_data["name"] = "My Resume"
    _save_profile("default", profile_data)

    # Update config: add activeProfile without clobbering other fields
    config = _load_config()
    config["activeProfile"] = "default"
    _save_config(config)

    # Remove old file
    OLD_RESUME_PATH.unlink(missing_ok=True)
    log.info("[migration] complete; active profile: default")


# ── Preview generation ────────────────────────────────────────────────────────

def _generate_static_previews():
    """Generate dummy-data preview PDFs for all templates, skipping if already cached."""
    current_version = str(PREVIEW_VERSION)
    stored_version = _VERSION_FILE.read_text().strip() if _VERSION_FILE.exists() else ""

    if stored_version != current_version:
        log.info("[previews] version changed (%s → %s), clearing old previews", stored_version, current_version)
        for f in PREVIEWS_DIR.glob("*.pdf"):
            f.unlink(missing_ok=True)
        for f in PREVIEWS_DIR.glob("*.png"):
            f.unlink(missing_ok=True)
        # Write version NOW so an interrupted run doesn't re-clear on the next launch
        _VERSION_FILE.write_text(current_version)

    missing = [t for t in _VALID_TEMPLATES if not (PREVIEWS_DIR / f"{t}_preview.pdf").exists()]
    if not missing:
        log.info("[previews] all %d previews cached, skipping generation (version %s)", len(_VALID_TEMPLATES), current_version)
        return

    log.info("[previews] generating %d missing preview PDF(s): %s", len(missing), missing)
    for template_name in missing:
        pdf_out = PREVIEWS_DIR / f"{template_name}_preview.pdf"
        render_preview_pdf_to_path(template_name, str(pdf_out))
        log.info("[previews] saved %s_preview.pdf (%d bytes)", template_name, pdf_out.stat().st_size)

    _VERSION_FILE.write_text(current_version)
    log.info("[previews] all static previews ready (version %s)", current_version)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Migrate old data structure first (fast, synchronous)
    _migrate_if_needed()
    # Run Playwright (sync API) in a thread so it doesn't block the event loop
    await asyncio.get_event_loop().run_in_executor(None, _generate_static_previews)
    yield


app = FastAPI(title="Resume Editor Sidecar", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    body = await request.body()
    log.error("[422] %s %s — body: %s — errors: %s", request.method, request.url.path, body.decode(), exc.errors())
    return JSONResponse(status_code=422, content={"detail": exc.errors(), "body": body.decode()})


# ── Pydantic models ───────────────────────────────────────────────────────────

class EditResumeRequest(BaseModel):
    jd_text: str
    profile_resume: dict               # profile-specific sections (no basics/education)
    profile_name: str = ""             # e.g. "Backend Engineer"
    basics: dict = {}                  # shared basics dict: { basics: {...}, education: [...] }
    shared_education: list = []        # shared education list
    user_instructions: str = ""
    llm_config: Optional[dict] = None
    transformers_context: dict = {}


class ReaskSectionRequest(BaseModel):
    section_key: str
    section_content: Any
    feedback: str
    jd_text: str
    user_instructions: str
    llm_config: Optional[dict] = None


class ExportPdfRequest(BaseModel):
    resume: dict
    template: str = "jake"
    section_order: list = []
    active_sections: list = []
    save_path: str = "~/Documents/Resumes"
    font_size: float = 10.0
    auto_fit: bool = False
    profile_id: str = ""
    profile_name: str = ""
    jd_text: str = ""
    transformers_context: dict = {}


class PreviewResumeRequest(BaseModel):
    resume: dict
    template: str = "jake"
    section_order: list = []
    active_sections: list = []
    font_size: float = 10.0


class PreviewPdfRequest(BaseModel):
    resume: dict
    template: str = "jake"
    section_order: list = []
    active_sections: list = []
    font_size: float = 10.0


class ExtractResumeRequest(BaseModel):
    file_content: str   # base64 data URL
    file_name: str
    llm_config: Optional[dict] = None


class ValidateTemplateRequest(BaseModel):
    role: str
    level: str
    user_feedback: str = ""
    current_template: Optional[str] = None
    current_sections: Optional[list] = None
    llm_config: Optional[dict] = None


class SyncMasterResumeRequest(BaseModel):
    resume_before: dict
    resume_after: dict
    role: str = ""
    level: str = ""
    llm_config: Optional[dict] = None


class TestConnectionRequest(BaseModel):
    llm_config: Optional[dict] = None


class CreateProfileRequest(BaseModel):
    name: str
    file: str           # base64 data URL
    extension: str      # .tex / .docx / .pdf
    llm_config: Optional[dict] = None


class SwitchProfileRequest(BaseModel):
    profileId: str


class UpdateProfileRequest(BaseModel):
    resume: dict


class UpdateSharedRequest(BaseModel):
    shared: dict


class SyncProfileRequest(BaseModel):
    profile_id: str
    resume_before: dict
    resume_after: dict
    role: str = ""
    level: str = ""
    llm_config: Optional[dict] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "resume-editor-sidecar"}


# ── Profile management ────────────────────────────────────────────────────────

@app.get("/profiles")
def get_profiles():
    """List all profiles, the active profile ID, and shared data."""
    profile_ids = _list_profile_ids()
    profiles = []
    for pid in profile_ids:
        data = _load_profile(pid)
        profiles.append({
            "id": data.get("id", pid),
            "name": data.get("name", pid),
        })

    config = _load_config()
    active_id = config.get("activeProfile")
    # Fall back to first profile if activeProfile is stale or missing
    if active_id not in profile_ids and profile_ids:
        active_id = profile_ids[0]

    return {
        "profiles": profiles,
        "activeProfile": active_id,
        "shared": _load_shared(),
    }


@app.post("/create-profile")
def create_profile(req: CreateProfileRequest):
    """
    Extract a resume file and save it as a new profile.
    Basics and education are stripped (they live in shared.json).
    Maximum 3 profiles.
    """
    try:
        existing_ids = _list_profile_ids()
        if len(existing_ids) >= 3:
            raise HTTPException(status_code=400, detail="Maximum 3 profiles allowed")

        if not req.llm_config:
            raise HTTPException(status_code=400, detail="No model configured")

        # Decode file
        raw = req.file
        if "," in raw:
            raw = raw.split(",", 1)[1]
        file_bytes = base64.b64decode(raw)

        ext = req.extension.lower()
        if ext not in (".tex", ".docx", ".pdf"):
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{ext}'. Accepted: .tex, .docx, .pdf",
            )

        client = LLMClient.from_config(req.llm_config)
        full_resume = extract_resume_to_json(file_bytes, ext, client)

        # Strip shared parts; they stay in shared.json
        profile_data = {k: v for k, v in full_resume.items() if k not in _SHARED_KEYS}

        slug = _slugify(req.name)
        profile_id = _unique_id(slug, existing_ids)
        profile_data["id"] = profile_id
        profile_data["name"] = req.name

        _save_profile(profile_id, profile_data)
        log.info("[create-profile] created profile '%s' (id=%s)", req.name, profile_id)

        # Write shared fields (basics + education) into shared.json.
        # Merge with whatever's already there so existing profiles are unaffected.
        existing_shared = _load_shared()
        new_shared = {k: v for k, v in full_resume.items() if k in _SHARED_KEYS}
        merged_shared = {**existing_shared, **new_shared}
        _save_shared(merged_shared)
        log.info("[create-profile] wrote shared.json keys: %s", list(merged_shared.keys()))

        return {"profile": {"id": profile_id, "name": req.name}}

    except HTTPException:
        raise
    except Exception as e:
        log.exception("[create-profile] error")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/switch-profile")
def switch_profile(req: SwitchProfileRequest):
    """Set the active profile in config.json and return the full merged resume."""
    profile_ids = _list_profile_ids()
    if req.profileId not in profile_ids:
        raise HTTPException(status_code=404, detail=f"Profile '{req.profileId}' not found")

    config = _load_config()
    config["activeProfile"] = req.profileId
    _save_config(config)

    log.info("[switch-profile] switched to '%s'", req.profileId)
    return {
        "activeProfile": req.profileId,
        "resume": _get_full_resume(req.profileId),
    }


@app.get("/profile/{profile_id}")
def get_profile(profile_id: str):
    """Return the full resume for a profile (shared + profile merged)."""
    profile_ids = _list_profile_ids()
    if profile_id not in profile_ids:
        raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found")
    return _get_full_resume(profile_id)


@app.put("/profile/{profile_id}")
def update_profile(profile_id: str, req: UpdateProfileRequest):
    """Save updated resume content for a profile. Strips shared keys; preserves id/name."""
    profile_ids = _list_profile_ids()
    if profile_id not in profile_ids:
        raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found")

    existing = _load_profile(profile_id)
    profile_data = {k: v for k, v in req.resume.items() if k not in _SHARED_KEYS}
    profile_data["id"] = existing.get("id", profile_id)
    profile_data["name"] = existing.get("name", profile_id)

    _save_profile(profile_id, profile_data)
    log.info("[update-profile] saved profile '%s'", profile_id)
    return {"success": True}


@app.post("/reset")
def reset_all():
    """Delete everything in ~/.resume-editor/ and start fresh."""
    shutil.rmtree(DATA_DIR)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log.info("[reset] wiped and recreated %s", DATA_DIR)
    return {"success": True}


@app.delete("/profile/{profile_id}")
def delete_profile(profile_id: str):
    """Delete a profile. Cannot delete the last remaining profile."""
    profile_ids = _list_profile_ids()
    if len(profile_ids) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last remaining profile")
    if profile_id not in profile_ids:
        raise HTTPException(status_code=404, detail=f"Profile '{profile_id}' not found")

    shutil.rmtree(str(PROFILES_DIR / profile_id))
    log.info("[delete-profile] deleted profile '%s'", profile_id)

    config = _load_config()
    if config.get("activeProfile") == profile_id:
        remaining = [p for p in profile_ids if p != profile_id]
        config["activeProfile"] = remaining[0]
        _save_config(config)

    return {"success": True, "activeProfile": config.get("activeProfile")}


# ── Shared data (basics + education) ─────────────────────────────────────────

@app.get("/shared")
def get_shared():
    """Return shared.json (basics + education, applies to all profiles)."""
    return _load_shared()


@app.put("/shared")
def update_shared(req: UpdateSharedRequest):
    """Update basics and/or education in shared.json."""
    shared = _load_shared()
    if "basics" in req.shared:
        shared["basics"] = req.shared["basics"]
    if "education" in req.shared:
        shared["education"] = req.shared["education"]
    _save_shared(shared)
    return {"success": True}


# ── Resume extraction ─────────────────────────────────────────────────────────

@app.post("/extract-resume")
def extract_resume(req: ExtractResumeRequest):
    """
    Accept a .tex, .docx, or .pdf resume file (base64 data URL),
    extract its content using the LLM, and return a JSON Resume schema dict.
    """
    try:
        if not req.llm_config:
            raise HTTPException(status_code=400, detail="No model configured")

        # Decode base64 data URL
        if "," in req.file_content:
            b64 = req.file_content.split(",", 1)[1]
        else:
            b64 = req.file_content
        file_bytes = base64.b64decode(b64)

        ext = Path(req.file_name).suffix.lower()
        if ext not in (".tex", ".docx", ".pdf"):
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{ext}'. Accepted: .tex, .docx, .pdf",
            )

        client = LLMClient.from_config(req.llm_config)
        resume_json = extract_resume_to_json(file_bytes, ext, client)

        log.info("[extract-resume] extraction complete")
        log.debug(f"[extract-resume] result:\n{json.dumps(resume_json, indent=2)}")

        return {"resume": resume_json}

    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"LLM returned invalid JSON: {e}")
    except Exception as e:
        log.exception("[extract-resume] error")
        raise HTTPException(status_code=500, detail=str(e))


# ── Template validation ───────────────────────────────────────────────────────

_VALIDATE_SYSTEM = """You are a resume layout consultant. Recommend the best resume template and section order for the given role and experience level.

Available templates:
- jake: Clean, technical, single-column. Ideal for software engineers and technical IC roles.
- sb2nov: Academic two-column date layout. Ideal for ML engineers, data scientists, researchers.
- faangpath: Professional business style. Ideal for PMs, business analysts, TPMs.
- myresume: Minimalist personal style. Works well for data analysts and mid-level professionals.

Available sections: summary, experience, education, skills, projects, certifications, publications, awards, volunteer, languages

Guidelines:
- entry level: put education near the top; omit summary unless background is distinctive
- mid/senior level: experience first (or summary then experience); education at the bottom
- ML/research roles: include publications if relevant
- PM/BA/TPM roles: include certifications
- Keep section list lean: only sections that matter for the role

Return ONLY valid JSON, no commentary:
{"template": "template_name", "sections": ["s1", "s2", ...], "reason": "1-2 sentence explanation"}"""


@app.post("/validate-template")
def validate_template(req: ValidateTemplateRequest):
    """
    Use the preset table as a starting point, then let the LLM validate/adjust
    based on role, level, and optional user feedback.
    Returns {template, sections, reason}.
    """
    try:
        if not req.llm_config:
            raise HTTPException(status_code=400, detail="No model configured")

        preset = get_preset(req.role, req.level)
        suggested_template = req.current_template or preset["template"]
        suggested_sections = req.current_sections or preset["sections"]

        feedback_block = (
            f"\nUser feedback: {req.user_feedback}" if req.user_feedback else ""
        )

        user_prompt = (
            f"Role: {req.role}\n"
            f"Level: {req.level}\n"
            f"Preset suggestion: template={suggested_template}, sections={suggested_sections}"
            f"{feedback_block}\n\n"
            "Return the best template and sections as JSON."
        )

        client = LLMClient.from_config(req.llm_config)
        raw = client.complete(_VALIDATE_SYSTEM, user_prompt, max_tokens=512)

        result = _extract_json(raw)

        # Ensure required keys are present; fall back to preset if missing
        template = result.get("template") or suggested_template
        sections = result.get("sections") or suggested_sections
        reason = result.get("reason") or "Best match for your role and experience level."

        log.info(f"[validate-template] {req.role}/{req.level} → {template}, {sections}")

        return {"template": template, "sections": sections, "reason": reason}

    except HTTPException:
        raise
    except json.JSONDecodeError:
        # LLM returned malformed JSON; fall back to preset
        preset = get_preset(req.role, req.level)
        return {
            "template": preset["template"],
            "sections": preset["sections"],
            "reason": "Using default recommendation for your role and experience level.",
        }
    except Exception as e:
        log.exception("[validate-template] error")
        raise HTTPException(status_code=500, detail=str(e))


# ── Resume editing ────────────────────────────────────────────────────────────

_STATIC_SYSTEM_PROMPT = """You are a resume emphasizer, not a fiction writer.

YOUR CORE JOB:
Read the resume and job description. Strengthen JD alignment in the summary and experience bullets: visible themes and keywords from the posting where they truthfully match the candidate's work. Do not edit for the sake of editing, but invisible or copy-paste output is a failure—the reader should see this resume was tuned to THIS job.

WHAT TO PRESERVE (never change these):
- All specific numbers and metrics exactly as written
- All specific product names, API names, tool names, model names
- All specific technical architecture details
- All bullets that already strongly match the JD — keep word for word
- Never move a metric from one bullet to another

DOMAIN PROTECTION:
- Never change the candidate's core domain
- Never add any skill, tool, or technology not in the allowed skills list
- If JD requires something the candidate does not have — skip it silently

WHAT YOU MAY CHANGE:
- Reorder bullet points within a role to put most JD-relevant first
- Reorder skill categories to put most relevant first
- Rewrite the summary to better reflect JD priorities
- Lightly reword a bullet opening or framing — but preserve all specifics inside
- Replace weak verbs with stronger ones from this list only:
  Built, Engineered, Designed, Developed, Implemented, Reduced, Improved,
  Increased, Cut, Deployed, Migrated, Automated, Delivered, Benchmarked,
  Conducted, Diagnosed, Validated, Launched

WHAT YOU MUST NEVER DO:
- Never use backticks, asterisks, or any markdown inside text
- Never merge two bullets into one or split one bullet into two
- Never swap or move metrics between bullets
- Never remove specific technical details to shorten a bullet
- Never add skills not in the allowed list
- Never use: leverage, optimize, unleash, game-changing, revolutionary,
  transformative, dive into, unlock potential
- Never use em dashes — use commas or semicolons instead
- Never use passive voice
- Never start a bullet with: Responsible for, Worked on, Helped with,
  Was involved in, Supported, Assisted

WRITING STANDARD:
- Every bullet leads with a strong past-tense action verb
- Every summary claim must be backed by a bullet in experience
- Prefer concise bullets — aim for 1-2 lines, never exceed 3 lines
- Write like a senior engineer talking to another engineer

BEFORE RETURNING — verify:
- No backticks or markdown formatting anywhere
- No bullet was merged or split
- All specific numbers and names from originals are preserved
- No skill appears that was not in the allowed list
- Summary claims all have supporting bullets

OUTPUT:
Return only valid JSON. Exact same structure and keys as input.
Same number of items in every array. No commentary. No code fences."""


def build_skill_allowlist(profile: dict) -> list:
    return [
        item
        for skill_group in profile.get("skills", [])
        for item in skill_group.get("items", [])
    ]


def build_candidate_persona(basics: dict, profile: dict, config: dict, skill_allowlist: list) -> str:
    top_skills = skill_allowlist[:12]
    companies = [exp.get("company", "") for exp in profile.get("experience", [])]
    education = basics.get("education", [{}])
    edu = education[0] if education else {}
    name = basics.get("basics", {}).get("name", "")
    profile_name = profile.get("name", "")
    level = config.get("level", "")

    return (
        f"CANDIDATE PROFILE:\n"
        f"- Name: {name}\n"
        f"- Targeting: {profile_name} roles\n"
        f"- Experience level: {level}\n"
        f"- Education: {edu.get('degree', '')} from {edu.get('institution', '')}\n"
        f"- Allowed skills (strict list): {', '.join(top_skills)}\n"
        f"- Experience at: {', '.join(companies)}\n"
        f"- Domain: {profile_name} — this domain must be preserved in the output. "
        f"Never transform this into a different role domain."
    )


def build_dynamic_prompt(
    profile_resume: dict,
    basics: dict,
    jd_text: str,
    candidate_persona: str,
    user_instructions: str,
    transformers_context: dict,
) -> str:
    ctx = ""
    if transformers_context:
        detected_role = transformers_context.get("detected_role", "")
        keywords = transformers_context.get("must_include_keywords", [])
        seniority = transformers_context.get("seniority", "")
        company_type = transformers_context.get("company_type", "")
        weak_indices = transformers_context.get("weak_bullet_indices", [])

        ctx_parts = []
        if detected_role:
            ctx_parts.append(f"Role detected: {detected_role}")
        if keywords:
            ctx_parts.append(f"Keywords to surface naturally if present in profile: {', '.join(keywords)}")
        if seniority:
            ctx_parts.append(f"Seniority: {seniority}")
        if company_type:
            ctx_parts.append(f"Company type: {company_type}")
        if weak_indices:
            ctx_parts.append(
                f"Focus extra rewriting effort on bullets at indices: {', '.join(map(str, weak_indices))} "
                f"— these matched JD poorly"
            )
        if ctx_parts:
            ctx = "\n\nJD ANALYSIS (from local analysis):\n" + "\n".join(ctx_parts)

    user_instr = f"\n\nUser preferences:\n{user_instructions}" if user_instructions.strip() else ""

    log.info("[build_dynamic_prompt] JD text length: %d chars", len(jd_text))
    exp = profile_resume.get("experience", [{}])[0]
    return (
        f"{candidate_persona}{ctx}{user_instr}\n\n"
        f"Job Description:\n{jd_text}\n\n"
        f"Profile Resume (JSON):\n{json.dumps(profile_resume, indent=2)}\n\n"
        f"Return the tailored profile resume as valid JSON with the exact same structure."
    )


UNSAFE_VERB_UPGRADES = {
    "designed", "architected", "pioneered", "founded",
    "spearheaded", "established",
}


def _skill_matches(item: str, allowlist_lower: list) -> bool:
    """
    Three-pass lenient skill match — handles parentheticals, punctuation variants, etc.

    Pass 1 — direct substring both ways:
      "AWS" in "AWS (Lambda, S3, Athena)"  → True
      "Lambda" in "AWS (Lambda, S3, Athena)" → True

    Pass 2 — strip parenthetical groups from allowlist entry, retry:
      Allowlist "AWS (Lambda, S3, Athena)" → base "AWS"
      Generated "AWS" in base "AWS" → True

    Pass 3 — punctuation-free normalized substring:
      "NodeJS" → "nodejs"; "Node.js" → "nodejs" → True
      (Skipped for very short tokens to avoid "Go" matching "MongoDB")
    """
    g = item.lower().strip()

    def _norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]", "", s)

    g_norm = _norm(g)

    for orig in allowlist_lower:
        # Pass 1: direct substring both ways
        if g in orig or orig in g:
            return True
        # Pass 2: strip parenthetical groups from allowlist entry, retry
        orig_base = re.sub(r"\s*\([^)]*\)", "", orig).strip()
        if g in orig_base or orig_base in g:
            return True
        # Pass 3: punctuation-stripped substring — handles Node.js vs NodeJS, etc.
        # Skip short tokens (len ≤ 2) to avoid "Go" matching inside "MongoDB"
        orig_norm = _norm(orig)
        if len(g_norm) > 2 and len(orig_norm) > 2:
            if g_norm in orig_norm or orig_norm in g_norm:
                return True

    return False


def validate_output(original: dict, generated: dict, skill_allowlist: list) -> dict:
    """Post-generation safety pass: revert unsafe verb upgrades."""
    # Revert unsafe verb upgrades bullet-by-bullet
    for i, exp in enumerate(generated.get("experience", [])):
        orig_exps = original.get("experience", [])
        if i >= len(orig_exps):
            break
        orig_exp = orig_exps[i]
        for j, bullet in enumerate(exp.get("bullets", [])):
            orig_bullets = orig_exp.get("bullets", [])
            if j >= len(orig_bullets):
                break
            first_word = bullet.strip().split()[0].lower().rstrip(".,") if bullet.strip() else ""
            orig_first = orig_bullets[j].strip().split()[0].lower().rstrip(".,") if orig_bullets[j].strip() else ""
            if first_word in UNSAFE_VERB_UPGRADES and orig_first not in UNSAFE_VERB_UPGRADES:
                generated["experience"][i]["bullets"][j] = orig_bullets[j]

    return generated


def _extract_json(raw: str) -> dict:
    """
    Robustly extract a JSON object from an LLM response.
    Handles: code fences, preamble text, postamble text.
    """
    raw = raw.strip()

    # Strip code fences (```json ... ``` or ``` ... ```)
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if "```" in raw:
            raw = raw.rsplit("```", 1)[0]
        raw = raw.strip()

    # If there's preamble text before the JSON object, skip to the first {
    if not raw.startswith("{"):
        idx = raw.find("{")
        if idx == -1:
            raise json.JSONDecodeError("No JSON object found", raw, 0)
        raw = raw[idx:]

    # If there's postamble text after the JSON object, trim to the last }
    if not raw.endswith("}"):
        idx = raw.rfind("}")
        if idx == -1:
            raise json.JSONDecodeError("No closing } found", raw, len(raw))
        raw = raw[: idx + 1]

    return json.loads(raw)


@app.post("/edit-resume")
def edit_resume(req: EditResumeRequest):
    try:
        if not req.llm_config:
            raise HTTPException(status_code=400, detail="No model configured")

        config = _load_config()
        skill_allowlist = build_skill_allowlist(req.profile_resume)
        candidate_persona = build_candidate_persona(
            req.basics, req.profile_resume, config, skill_allowlist
        )

        try:
            validated, violations = run_pipeline(
                profile_resume=req.profile_resume,
                basics=req.basics,
                jd_text=req.jd_text,
                transformers_context=req.transformers_context,
                user_instructions=req.user_instructions,
                llm_config=req.llm_config,
                config=config,
                candidate_persona=candidate_persona,
                skill_allowlist=skill_allowlist,
            )
            log.info(
                "[edit-resume] pipeline succeeded — keys=%s violations=%d experience_blocks=%d",
                list(validated.keys()),
                len(violations),
                len(validated.get("experience", [])),
            )
            log.debug("[edit-resume] pipeline return snippet: %s", json.dumps(validated)[:600])
            return {"resume": validated, "pipeline_violations": violations}

        except Exception as pipeline_err:
            log.warning(
                "[edit-resume] pipeline failed (%s) — falling back to single-LLM call",
                pipeline_err,
            )
            # ── Fallback: original single-LLM approach ──────────────────────
            dynamic_prompt = build_dynamic_prompt(
                profile_resume=req.profile_resume,
                basics=req.basics,
                jd_text=req.jd_text,
                candidate_persona=candidate_persona,
                user_instructions=req.user_instructions,
                transformers_context=req.transformers_context,
            )
            llm = LLMClient.from_config(req.llm_config)
            raw = llm.complete(
                static_prompt=_STATIC_SYSTEM_PROMPT,
                dynamic_prompt=dynamic_prompt,
                max_tokens=8192,
            )
            clean = raw.strip()
            if clean.startswith("```"):
                clean = re.sub(r"^```[a-z]*\n?", "", clean)
                clean = re.sub(r"\n?```$", "", clean)
            edited = json.loads(clean)
            validated = validate_output(req.profile_resume, edited, skill_allowlist)
            log.info(
                "[edit-resume] fallback OK — keys=%s experience_blocks=%d",
                list(validated.keys()),
                len(validated.get("experience", [])),
            )
            log.debug("[edit-resume] fallback return snippet: %s", json.dumps(validated)[:600])
            return {"resume": validated, "pipeline_violations": []}

    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        log.error("[edit-resume] JSON parse failed: %s", e)
        raise HTTPException(status_code=500, detail=f"LLM returned invalid JSON: {e}")
    except Exception as e:
        log.exception("[edit-resume] error")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/reask-section")
def reask_section(req: ReaskSectionRequest):
    try:
        if not req.llm_config:
            raise HTTPException(status_code=400, detail="No model configured")

        client = LLMClient.from_config(req.llm_config)

        system_prompt = """You are an expert resume writer. Rewrite a specific resume section based on user feedback.

Rules:
- Return ONLY the rewritten content in the exact same JSON structure and type as the input
- No commentary, no markdown, no code fences
- Plain text values only: no bullet markers, no special characters
- Keep language achievement-focused and concise
- Incorporate the user's feedback precisely"""

        user_prompt = f"""Section: {req.section_key}

Current Content:
{json.dumps(req.section_content, indent=2)}

User Feedback:
{req.feedback}

Job Description Context:
{req.jd_text[:500] if req.jd_text else 'Not provided'}

User Instructions:
{req.user_instructions or 'None'}

Return the rewritten section content as JSON only (same type/structure as input)."""

        result = client.complete(system_prompt, user_prompt)
        result = result.strip()
        if result.startswith("```"):
            result = result.split("\n", 1)[1]
            if result.endswith("```"):
                result = result.rsplit("```", 1)[0]

        content = json.loads(result)
        return {"content": content}

    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"AI returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Preview / export ──────────────────────────────────────────────────────────

@app.post("/preview-resume")
def preview_resume(req: PreviewResumeRequest):
    """Render resume to HTML for live preview (no PDF/Playwright, just Jinja2)."""
    try:
        html = render_html(
            resume=req.resume,
            template_name=req.template,
            section_order=req.section_order,
            active_sections=req.active_sections,
            font_size=req.font_size,
        )
        return {"html": html}
    except Exception as e:
        log.exception("[preview-resume] error")
        raise HTTPException(status_code=500, detail=str(e))


_PREVIEW_PDF_PATH = DATA_DIR / "preview.pdf"


@app.post("/preview-pdf")
def preview_pdf(req: PreviewPdfRequest):
    """
    Render resume to a fixed PDF path (~/.resume-editor/preview.pdf).
    Returns the absolute path so the frontend can load it via convertFileSrc.
    """
    try:
        _PREVIEW_PDF_PATH.parent.mkdir(parents=True, exist_ok=True)
        overflow_warning = render_pdf_to_path(
            resume=req.resume,
            template_name=req.template,
            section_order=req.section_order,
            active_sections=req.active_sections,
            output_path=str(_PREVIEW_PDF_PATH),
            font_size=req.font_size,
        )
        log.info("[preview-pdf] saved to %s overflow=%s", _PREVIEW_PDF_PATH, overflow_warning is not None)
        return {"file_path": str(_PREVIEW_PDF_PATH), "overflow_warning": overflow_warning}
    except Exception as e:
        log.exception("[preview-pdf] error")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/preview-pdf-file")
def get_preview_pdf_file():
    """Serve the last generated preview PDF over HTTP so WKWebView can display it."""
    if not _PREVIEW_PDF_PATH.exists():
        raise HTTPException(status_code=404, detail="No preview PDF generated yet")
    return FileResponse(
        path=str(_PREVIEW_PDF_PATH),
        media_type="application/pdf",
        headers={"Cache-Control": "no-store"},
    )


_COMMON_WORDS = {
    # Articles / pronouns / prepositions
    "the", "our", "this", "that", "us", "we", "you", "your", "their",
    # Generic JD nouns that appear after trigger words
    "role", "team", "job", "position", "company", "organization", "group",
    "business", "mission", "vision", "work", "way", "world", "future",
    # Conjunctions / misc
    "and", "for", "with", "at", "in", "on", "of", "an", "a",
}

_ALLCAPS_SKIP = {
    "THE", "AND", "FOR", "WITH", "ARE", "YOU", "WE", "OUR", "THIS", "THAT",
    "WILL", "CAN", "NOT", "BUT", "YOUR", "JOB", "ROLE", "TEAM", "JOIN",
    "ABOUT", "WORK", "ALL", "NEW", "INC", "LLC", "LTD", "USA",
}


def _extract_company_name(jd_text: str) -> str:
    """Best-effort company name extraction from a JD. Returns 'Unknown Company' on failure."""
    if not jd_text:
        return "Unknown Company"

    def _clean(s: str) -> str:
        s = s.strip(".,")
        if s.endswith("'s"):
            s = s[:-2]
        return s.strip()

    # Pattern 1: trigger words immediately before a capitalised name
    # "at Acme", "join Acme", "joining Acme" — filter generic words
    for m in re.finditer(
        r"\b(?:at|join|joining)\s+([A-Z][A-Za-z0-9&.'\-]{1,40})(?:'s)?\b",
        jd_text,
    ):
        candidate = _clean(m.group(1))
        if candidate.lower() not in _COMMON_WORDS:
            return candidate

    # Pattern 2: possessive "[Company]'s <product|team|technology|...>"
    # catches "Disney's technology", "Stripe's platform", etc.
    m = re.search(
        r"\b([A-Z][A-Za-z0-9&\-]{2,40})'s\s+"
        r"(?:products?|teams?|platforms?|technology|media|business|services?|"
        r"systems?|mission|vision|culture|values?|future|past|story|brand)",
        jd_text,
    )
    if m:
        candidate = m.group(1)
        if candidate.lower() not in _COMMON_WORDS:
            return candidate

    # Pattern 3: "About <Company>" section header (skip generic words)
    m = re.search(r"\bAbout\s+([A-Z][A-Za-z0-9&.'\-]{1,40})\b", jd_text)
    if m:
        candidate = _clean(m.group(1))
        if candidate.lower() not in _COMMON_WORDS:
            return candidate

    # Pattern 4: first all-caps word — ticker / acronym company names (OUTSET, ESPN)
    # Keep original casing; do NOT call capitalize() which breaks acronyms
    m = re.search(r"\b([A-Z]{2,12})\b", jd_text[:600])
    if m:
        word = m.group(1)
        if word not in _ALLCAPS_SKIP:
            return word

    return "Unknown Company"


def _compute_match_score(must_include_keywords: list, resume: dict) -> int:
    """Percentage of must_include_keywords found in the resume's skill allowlist (0-100)."""
    if not must_include_keywords:
        return 0
    allowlist = [s.lower() for s in build_skill_allowlist(resume)]
    matched = sum(
        1 for kw in must_include_keywords
        if any(kw.lower() in skill or skill in kw.lower() for skill in allowlist)
    )
    return round(matched / len(must_include_keywords) * 100)


def _append_history(
    profile_id: str,
    profile_name: str,
    jd_text: str,
    transformers_context: dict,
    resume: dict,
    font_size: float,
    pages: int,
):
    history_path = Path.home() / ".resume-editor" / "history.json"
    try:
        if history_path.exists():
            with open(history_path) as f:
                history = json.load(f)
        else:
            history = {"applications": []}

        keywords = transformers_context.get("must_include_keywords", [])
        role = transformers_context.get("detected_role") or profile_name or "Unknown Role"

        entry = {
            "date": datetime.now().isoformat()[:10],
            "company": _extract_company_name(jd_text),
            "role": role,
            "profile_used": profile_id,
            "match_score": _compute_match_score(keywords, resume),
            "jd_snippet": jd_text[:200].strip(),
            "jd_keywords": keywords,
            "seniority": transformers_context.get("seniority", ""),
            "company_type": transformers_context.get("company_type", ""),
            "font_size": font_size,
            "pages": pages,
        }

        history["applications"].append(entry)

        history_path.parent.mkdir(parents=True, exist_ok=True)
        with open(history_path, "w") as f:
            json.dump(history, f, indent=2)
    except Exception as e:
        logging.warning(f"History append failed (non-critical): {e}")


@app.post("/export-pdf")
def export_pdf(req: ExportPdfRequest):
    try:
        save_dir = Path(os.path.expanduser(req.save_path))
        save_dir.mkdir(parents=True, exist_ok=True)

        file_path, chosen_font_size, overflow_warning = export_to_pdf(
            resume=req.resume,
            template=req.template,
            section_order=req.section_order,
            active_sections=req.active_sections,
            save_dir=str(save_dir),
            font_size=req.font_size,
            auto_fit=req.auto_fit,
        )

        log.info("[export-pdf] saved to %s (font_size=%.1f, overflow=%s)",
                 file_path, chosen_font_size, overflow_warning is not None)

        _append_history(
            profile_id=req.profile_id,
            profile_name=req.profile_name,
            jd_text=req.jd_text,
            transformers_context=req.transformers_context,
            resume=req.resume,
            font_size=chosen_font_size,
            pages=1,
        )

        return {
            "success": True,
            "file_path": file_path,
            "font_size": chosen_font_size,
            "overflow_warning": overflow_warning,
        }
    except Exception as e:
        log.exception("[export-pdf] error")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/history")
def get_export_history():
    """Return PDF export history from ~/.resume-editor/history.json (newest entries last in file)."""
    history_path = Path.home() / ".resume-editor" / "history.json"
    if not history_path.exists():
        return {"applications": []}
    try:
        with open(history_path, encoding="utf-8") as f:
            data = json.load(f)
        apps = data.get("applications")
        if not isinstance(apps, list):
            return {"applications": []}
        return {"applications": apps}
    except Exception as e:
        log.warning("[history] read failed: %s", e)
        return {"applications": []}


@app.get("/prompt-health")
def prompt_health():
    """
    Return the top recurring pipeline violation rules from pipeline_violations.json.
    Use this to identify which Critic rules fire most often and tune prompts accordingly.
    """
    return analyze_critic_patterns()


# ── Resume quality review ─────────────────────────────────────────────────────

_SYNC_RESUME_SYSTEM = """You are a resume quality reviewer. A user has edited their master resume. Review the updated content and identify any issues.

Check for:
- Weak action verbs or vague language ("responsible for", "helped with", "worked on")
- Bullets that start with "I" instead of an action verb
- Missing metrics where a number would strengthen the point
- Skills mentioned in bullets but absent from the skills section
- Empty or near-empty sections
- Any content that looks truncated or corrupted

Return a JSON array of findings. If everything looks good, return an empty array [].

Format: [{"section": "section_name", "type": "error|warning|info", "message": "specific, actionable feedback"}]
- "error": data corruption or empty required fields
- "warning": quality issue worth addressing
- "info": minor suggestion or positive observation

Return ONLY the JSON array, no commentary, no code fences."""


@app.post("/sync-master-resume")
def sync_master_resume(req: SyncMasterResumeRequest):
    """
    Review the edited master resume for quality issues and structural problems.
    Returns a list of suggestions the user can accept or ignore before saving.
    """
    try:
        if not req.llm_config:
            raise HTTPException(status_code=400, detail="No model configured")

        role_line = f"Role: {req.role}\nLevel: {req.level}\n\n" if req.role else ""

        user_prompt = (
            f"{role_line}"
            f"Updated Resume (JSON):\n{json.dumps(req.resume_after, indent=2)}\n\n"
            "Return your findings as a JSON array (empty array if no issues)."
        )

        client = LLMClient.from_config(req.llm_config)
        raw = client.complete(_SYNC_RESUME_SYSTEM, user_prompt, max_tokens=1024)
        try:
            suggestions = _extract_json(raw)
        except (json.JSONDecodeError, ValueError):
            # sync endpoints return a list; try extracting array directly
            raw2 = raw.strip()
            if raw2.startswith("```"):
                raw2 = raw2.split("\n", 1)[1] if "\n" in raw2 else raw2[3:]
                if "```" in raw2:
                    raw2 = raw2.rsplit("```", 1)[0].strip()
            idx = raw2.find("[")
            if idx != -1:
                raw2 = raw2[idx:]
            ridx = raw2.rfind("]")
            if ridx != -1:
                raw2 = raw2[: ridx + 1]
            suggestions = json.loads(raw2)
        if not isinstance(suggestions, list):
            suggestions = []

        log.info("[sync-master-resume] %d suggestion(s)", len(suggestions))
        return {"suggestions": suggestions}

    except HTTPException:
        raise
    except json.JSONDecodeError:
        return {"suggestions": []}
    except Exception as e:
        log.exception("[sync-master-resume] error")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sync-profile")
def sync_profile(req: SyncProfileRequest):
    """
    Review a specific profile's resume for quality issues (same logic as sync-master-resume
    but scoped to one profile). Never touches shared.json.
    """
    try:
        if not req.llm_config:
            raise HTTPException(status_code=400, detail="No model configured")

        profile_ids = _list_profile_ids()
        if req.profile_id not in profile_ids:
            raise HTTPException(status_code=404, detail=f"Profile '{req.profile_id}' not found")

        role_line = f"Role: {req.role}\nLevel: {req.level}\n\n" if req.role else ""

        user_prompt = (
            f"{role_line}"
            f"Updated Resume (JSON):\n{json.dumps(req.resume_after, indent=2)}\n\n"
            "Return your findings as a JSON array (empty array if no issues)."
        )

        client = LLMClient.from_config(req.llm_config)
        raw = client.complete(_SYNC_RESUME_SYSTEM, user_prompt, max_tokens=1024)
        try:
            suggestions = _extract_json(raw)
        except (json.JSONDecodeError, ValueError):
            raw2 = raw.strip()
            if raw2.startswith("```"):
                raw2 = raw2.split("\n", 1)[1] if "\n" in raw2 else raw2[3:]
                if "```" in raw2:
                    raw2 = raw2.rsplit("```", 1)[0].strip()
            idx = raw2.find("[")
            if idx != -1:
                raw2 = raw2[idx:]
            ridx = raw2.rfind("]")
            if ridx != -1:
                raw2 = raw2[: ridx + 1]
            suggestions = json.loads(raw2)
        if not isinstance(suggestions, list):
            suggestions = []

        log.info("[sync-profile] profile=%s %d suggestion(s)", req.profile_id, len(suggestions))
        return {"suggestions": suggestions}

    except HTTPException:
        raise
    except json.JSONDecodeError:
        return {"suggestions": []}
    except Exception as e:
        log.exception("[sync-profile] error")
        raise HTTPException(status_code=500, detail=str(e))


# ── Utilities ─────────────────────────────────────────────────────────────────

@app.post("/test-connection")
def test_connection(req: TestConnectionRequest):
    try:
        if not req.llm_config:
            return {"success": False, "error": "No model config provided"}

        config = req.llm_config
        # For Ollama, check if the server is reachable before attempting LLM call
        if config.get("provider") == "ollama":
            import httpx
            base_url = config.get("base_url") or "http://localhost:11434"
            # Strip /v1 suffix for the reachability check
            ping_url = base_url.rstrip("/").removesuffix("/v1")
            try:
                httpx.get(f"{ping_url}/api/tags", timeout=3)
            except Exception:
                return {
                    "success": False,
                    "error": f"Ollama is not running at {ping_url}. Start it with: ollama serve",
                }

        client = LLMClient.from_config(config)
        result = client.complete("You are a test assistant.", "Reply with OK")

        if result and len(result.strip()) > 0:
            return {"success": True, "response": result.strip()}
        else:
            return {"success": False, "error": "Empty response from model"}
    except Exception as e:
        return {"success": False, "error": str(e)}


class OpenFolderRequest(BaseModel):
    path: str


@app.post("/open-folder")
def open_folder(req: OpenFolderRequest):
    """Reveal a file or folder in macOS Finder."""
    try:
        import subprocess
        target = os.path.expanduser(req.path)
        if os.path.isfile(target):
            subprocess.Popen(["open", "-R", target])
        else:
            subprocess.Popen(["open", target])
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/template-preview-pdf/{template_name}")
def template_preview_pdf(template_name: str):
    """Return the cached preview PDF for the named template, generating on-demand if missing."""
    if template_name not in _VALID_TEMPLATES:
        raise HTTPException(status_code=404, detail=f"Unknown template: {template_name}")
    pdf_path = PREVIEWS_DIR / f"{template_name}_preview.pdf"
    if not pdf_path.exists():
        log.info("[template-preview-pdf] generating on-demand for %s", template_name)
        render_preview_pdf_to_path(template_name, str(pdf_path))
    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        headers={"Cache-Control": "no-store"},
    )


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
