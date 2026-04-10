import sys
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
from pydantic import BaseModel
from typing import Optional, Any
import uvicorn
import os
import json
import base64
import tempfile
from pathlib import Path

from llm_client import LLMClient
from docx_parser import parse_docx, parse_tex
from pdf_exporter import export_to_pdf, export_to_tex

app = FastAPI(title="Resume Editor Sidecar")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ParseResumeRequest(BaseModel):
    file_content: str  # base64 data URL
    file_name: str


class ParseResearchRequest(BaseModel):
    file_content: str  # base64 data URL
    file_name: str


class EditResumeRequest(BaseModel):
    jd_text: str
    resume_sections: dict
    user_instructions: str
    research_text: Optional[str] = ""  # plain extracted text, not base64
    page_count: int = 1
    target_role: Optional[str] = ""
    llm_config: Optional[dict] = None


class ReaskSectionRequest(BaseModel):
    section_key: str
    section_content: Any
    feedback: str
    jd_text: str
    user_instructions: str
    llm_config: Optional[dict] = None


class ExportPdfRequest(BaseModel):
    sections: dict
    original_sections: Optional[dict] = None
    template_content: Optional[str] = None
    template_name: Optional[str] = None
    save_path: str


class TestConnectionRequest(BaseModel):
    llm_config: Optional[dict] = None


def _extract_research_text(content_b64: str, filename: str) -> str:
    """Decode a base64 data URL research file and extract plain text."""
    if not content_b64:
        return ""
    if not content_b64.startswith("data:"):
        # Already plain text
        return content_b64

    b64 = content_b64.split(",", 1)[1] if "," in content_b64 else content_b64
    file_bytes = base64.b64decode(b64)
    ext = Path(filename).suffix.lower() if filename else ".txt"

    if ext in (".txt", ".md"):
        return file_bytes.decode("utf-8", errors="replace")
    elif ext == ".docx":
        from docx import Document
        import io
        doc = Document(io.BytesIO(file_bytes))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    elif ext == ".pdf":
        try:
            from pypdf import PdfReader
            import io
            reader = PdfReader(io.BytesIO(file_bytes))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
        except ImportError:
            return "[PDF research file — install pypdf to enable text extraction]"
    else:
        # Best-effort UTF-8 decode
        return file_bytes.decode("utf-8", errors="replace")


@app.get("/health")
def health():
    return {"status": "ok", "service": "resume-editor-sidecar"}


@app.post("/parse-resume")
def parse_resume(req: ParseResumeRequest):
    try:
        # Decode base64 data URL
        if "," in req.file_content:
            b64 = req.file_content.split(",", 1)[1]
        else:
            b64 = req.file_content
        file_bytes = base64.b64decode(b64)

        ext = Path(req.file_name).suffix.lower()

        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        try:
            if ext == ".docx":
                sections = parse_docx(tmp_path)
            elif ext == ".tex":
                sections = parse_tex(tmp_path)
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")
        finally:
            os.unlink(tmp_path)

        return {"sections": sections}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/parse-research")
def parse_research(req: ParseResearchRequest):
    try:
        text = _extract_research_text(req.file_content, req.file_name)
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/edit-resume")
def edit_resume(req: EditResumeRequest):
    try:
        if not req.llm_config:
            raise HTTPException(status_code=400, detail="No model configured")

        client = LLMClient.from_config(req.llm_config)

        research_text = req.research_text or ""
        page_descriptor = f"{req.page_count} page{'s' if req.page_count > 1 else ''}"
        role_line = f" targeting a **{req.target_role}** role" if req.target_role else ""

        system_prompt = f"""You are an expert resume writer and career coach with 15 years of experience helping candidates land jobs at top companies.

You will be given:
1. A job description
2. The user's current resume sections as JSON
3. The user's personal instructions and preferences
4. (Optional) Research notes about the user

Your job is to tailor the resume content{role_line} for this specific job description.

CRITICAL — SURGICAL CONTENT REPLACEMENT ONLY:
- Return the EXACT same JSON keys as the input. Do NOT add, remove, or rename any keys.
- Preserve the EXACT same data type for every value (list stays list, string stays string, dict stays dict).
- Keep the EXACT same number of items in every list — do NOT add or remove list entries.
- Never change the number of bullet points. Never add sentences that did not exist. Never remove existing bullets. Only rewrite the text of each existing bullet point.
- Only change the text content inside existing items (bullet text, summaries, skill lists, etc.).
- Do NOT restructure, reorder, merge, or split any sections or list items.
- This output is used for direct in-place substitution into the original template file. Any structural change WILL break the output formatting.
- Return PLAIN TEXT only in all values — no LaTeX commands, no backslashes, no braces. The template already has all necessary formatting commands.

CONTENT RULES:
- Never invent experience, skills, or credentials the user does not have
- Prioritize keywords and phrases from the JD naturally throughout
- Keep bullet points achievement-focused with metrics where possible
- Follow the user's personal instructions strictly
- CRITICAL LENGTH CONSTRAINT: The final resume MUST fit within {page_descriptor} — be concise
- Return ONLY valid JSON — no commentary, no markdown, no code fences
- Do NOT add bullet markers ("- ", "• ", "* ") to list items — the template handles visual formatting"""

        user_prompt = f"""Job Description:
{req.jd_text}

Current Resume Sections (JSON):
{json.dumps(req.resume_sections, indent=2)}

User Instructions:
{req.user_instructions or 'None provided'}

Research Notes:
{research_text or 'None provided'}

Return the edited resume sections as valid JSON only."""

        result = client.complete(system_prompt, user_prompt)

        # Strip markdown code fences if present
        result = result.strip()
        if result.startswith("```"):
            result = result.split("\n", 1)[1]
            if result.endswith("```"):
                result = result.rsplit("```", 1)[0]

        log.info("="*80)
        log.info("EDIT-RESUME — RAW LLM RESPONSE")
        log.info("="*80)
        log.info(result)
        log.info("="*80)

        sections = json.loads(result)

        log.info("EDIT-RESUME — PARSED SECTIONS JSON")
        log.info("-"*80)
        log.info(json.dumps(sections, indent=2))
        log.info("-"*80)

        return {"sections": sections}

    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"AI returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/reask-section")
def reask_section(req: ReaskSectionRequest):
    try:
        if not req.llm_config:
            raise HTTPException(status_code=400, detail="No model configured")

        client = LLMClient.from_config(req.llm_config)

        system_prompt = """You are an expert resume writer. You will rewrite a specific section of a resume based on user feedback.

Rules:
- Return ONLY the rewritten content in the exact same JSON structure/type as the input
- No commentary, no markdown, no code fences
- Maintain achievement-focused, concise language
- Incorporate the user's feedback precisely
- Do NOT add bullet markers ("- ", "• ", "* ") to list items — return clean text only"""

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


@app.post("/export-pdf")
def export_pdf(req: ExportPdfRequest):
    try:
        # Ensure save directory exists (expand ~ to actual home dir)
        save_dir = Path(os.path.expanduser(req.save_path))
        save_dir.mkdir(parents=True, exist_ok=True)

        file_path = export_to_pdf(
            sections=req.sections,
            original_sections=req.original_sections,
            template_content=req.template_content,
            template_name=req.template_name,
            save_dir=str(save_dir),
        )

        return {"success": True, "file_path": file_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/export-tex")
def export_tex(req: ExportPdfRequest):
    try:
        save_dir = Path(os.path.expanduser(req.save_path))
        save_dir.mkdir(parents=True, exist_ok=True)

        orig_path, edit_path = export_to_tex(
            sections=req.sections,
            original_sections=req.original_sections,
            template_content=req.template_content,
            save_dir=str(save_dir),
        )

        return {"success": True, "original_path": orig_path, "edited_path": edit_path}
    except Exception as e:
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


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
