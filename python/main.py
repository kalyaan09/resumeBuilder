import sys
import os

import logging

LOG_FILE = "/tmp/resume_debug.log"

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8"),
        logging.StreamHandler(sys.stderr),
    ],
)
log = logging.getLogger("resume")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, Any
from contextlib import asynccontextmanager
import asyncio
import uvicorn
import os
import json
import base64
from pathlib import Path

from llm_client import LLMClient
from pdf_exporter import export_to_pdf, render_preview_pdf_to_path, render_html, render_pdf_to_path
from resume_extractor import extract_resume_to_json
from presets import get_preset

_VALID_TEMPLATES = {"jake", "faangpath", "sb2nov", "myresume"}

PREVIEW_VERSION = 1

# Store generated previews in user data dir — works in both dev and frozen mode
PREVIEWS_DIR = Path.home() / ".resume-editor" / "previews"
PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)
_VERSION_FILE = PREVIEWS_DIR / "version.txt"


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
        log.info("[previews] all %d previews cached — skipping generation (version %s)", len(_VALID_TEMPLATES), current_version)
        return

    log.info("[previews] generating %d missing preview(s): %s", len(missing), missing)
    for template_name in missing:
        out = PREVIEWS_DIR / f"{template_name}_preview.pdf"
        render_preview_pdf_to_path(template_name, str(out))
        log.info("[previews] saved %s_preview.pdf (%d bytes)", template_name, out.stat().st_size)

    _VERSION_FILE.write_text(current_version)
    log.info("[previews] all static previews ready (version %s)", current_version)


@asynccontextmanager
async def lifespan(app: FastAPI):
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


class EditResumeRequest(BaseModel):
    jd_text: str
    master_resume: dict           # full JSON Resume schema
    user_instructions: str = ""
    research_text: str = ""
    llm_config: Optional[dict] = None


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


@app.get("/health")
def health():
    return {"status": "ok", "service": "resume-editor-sidecar"}


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
- Keep section list lean — only sections that matter for the role

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

        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]

        result = json.loads(raw)

        # Ensure required keys are present; fall back to preset if missing
        template = result.get("template") or suggested_template
        sections = result.get("sections") or suggested_sections
        reason = result.get("reason") or "Best match for your role and experience level."

        log.info(f"[validate-template] {req.role}/{req.level} → {template}, {sections}")

        return {"template": template, "sections": sections, "reason": reason}

    except HTTPException:
        raise
    except json.JSONDecodeError:
        # LLM returned malformed JSON — fall back to preset
        preset = get_preset(req.role, req.level)
        return {
            "template": preset["template"],
            "sections": preset["sections"],
            "reason": "Using default recommendation for your role and experience level.",
        }
    except Exception as e:
        log.exception("[validate-template] error")
        raise HTTPException(status_code=500, detail=str(e))


_EDIT_RESUME_SYSTEM = """You are an expert resume writer with 15 years of experience helping candidates land jobs at top companies.

You will receive:
1. A job description
2. A master resume in JSON Resume format
3. User instructions and preferences
4. Optional research notes about the candidate

Your job is to tailor the resume content for this specific job description.

STRICT RULES:
- Return the EXACT same JSON structure — same keys, same types, same number of array items
- Never add or remove bullet points from any list
- Never invent experience, skills, or credentials the candidate does not have
- Only rewrite existing text content to better match the job description
- Prioritize keywords and phrases from the JD naturally throughout
- Keep bullets achievement-focused with metrics wherever they already exist
- Follow the user's personal instructions strictly
- Plain text only — no markdown, no LaTeX, no special characters
- Return valid JSON only, no commentary, no code fences"""


@app.post("/edit-resume")
def edit_resume(req: EditResumeRequest):
    try:
        if not req.llm_config:
            raise HTTPException(status_code=400, detail="No model configured")

        client = LLMClient.from_config(req.llm_config)

        user_prompt = (
            f"Job Description:\n{req.jd_text}\n\n"
            f"Master Resume (JSON):\n{json.dumps(req.master_resume, indent=2)}\n\n"
            f"User Instructions:\n{req.user_instructions or 'None provided'}\n\n"
            f"Research Notes:\n{req.research_text or 'None provided'}\n\n"
            "Return the tailored resume as valid JSON with the exact same structure."
        )

        raw = client.complete(_EDIT_RESUME_SYSTEM, user_prompt, max_tokens=8192)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]

        log.info("[edit-resume] raw response length: %d chars", len(raw))
        resume = json.loads(raw)
        log.info("[edit-resume] parsed OK")

        return {"resume": resume}

    except HTTPException:
        raise
    except json.JSONDecodeError as e:
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
- Plain text values only — no bullet markers, no special characters
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


@app.post("/preview-resume")
def preview_resume(req: PreviewResumeRequest):
    """Render resume to HTML for live preview — no PDF/Playwright, just Jinja2."""
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


_PREVIEW_PDF_PATH = Path.home() / ".resume-editor" / "preview.pdf"


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
        return {
            "success": True,
            "file_path": file_path,
            "font_size": chosen_font_size,
            "overflow_warning": overflow_warning,
        }
    except Exception as e:
        log.exception("[export-pdf] error")
        raise HTTPException(status_code=500, detail=str(e))


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
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1]
            if "```" in raw:
                raw = raw.rsplit("```", 1)[0]

        suggestions = json.loads(raw)
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
