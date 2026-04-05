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
from pdf_exporter import export_to_pdf

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


class EditResumeRequest(BaseModel):
    jd_text: str
    resume_sections: dict
    user_instructions: str
    research_content: Optional[str] = ""
    page_count: int = 1
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
    template_content: Optional[str] = None
    template_name: Optional[str] = None
    save_path: str


class TestConnectionRequest(BaseModel):
    llm_config: Optional[dict] = None


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


@app.post("/edit-resume")
def edit_resume(req: EditResumeRequest):
    try:
        if not req.llm_config:
            raise HTTPException(status_code=400, detail="No model configured")

        client = LLMClient.from_config(req.llm_config)

        page_descriptor = f"{req.page_count} page{'s' if req.page_count > 1 else ''}"

        system_prompt = f"""You are an expert resume writer and career coach with 15 years of experience helping candidates land jobs at top companies.

You will be given:
1. A job description
2. The user's current resume sections
3. The user's personal instructions and preferences
4. (Optional) Research notes about the user

Your job is to rewrite the resume to be perfectly tailored for this specific job description.

CRITICAL LENGTH CONSTRAINT: The final resume MUST fit within {page_descriptor}. Be concise and prioritize the most impactful content. Cut ruthlessly if needed.

Rules:
- Never invent experience, skills, or credentials the user does not have
- Prioritize keywords and phrases from the JD naturally throughout
- Keep bullet points achievement-focused with metrics where possible
- Follow the user's personal instructions strictly
- Return ONLY valid JSON matching the exact input schema — no commentary, no markdown, no code fences
- Every section must be present in output even if unchanged
- Maintain the exact same JSON structure/keys as the input"""

        user_prompt = f"""Job Description:
{req.jd_text}

Current Resume Sections (JSON):
{json.dumps(req.resume_sections, indent=2)}

User Instructions:
{req.user_instructions or 'None provided'}

Research Notes:
{req.research_content or 'None provided'}

Return the edited resume sections as valid JSON only."""

        result = client.complete(system_prompt, user_prompt)

        # Strip markdown code fences if present
        result = result.strip()
        if result.startswith("```"):
            result = result.split("\n", 1)[1]
            if result.endswith("```"):
                result = result.rsplit("```", 1)[0]

        sections = json.loads(result)
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


@app.post("/export-pdf")
def export_pdf(req: ExportPdfRequest):
    try:
        # Ensure save directory exists (expand ~ to actual home dir)
        save_dir = Path(os.path.expanduser(req.save_path))
        save_dir.mkdir(parents=True, exist_ok=True)

        file_path = export_to_pdf(
            sections=req.sections,
            template_content=req.template_content,
            template_name=req.template_name,
            save_dir=str(save_dir),
        )

        return {"success": True, "file_path": file_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/test-connection")
def test_connection(req: TestConnectionRequest):
    try:
        if not req.llm_config:
            return {"success": False, "error": "No model config provided"}

        client = LLMClient.from_config(req.llm_config)
        result = client.complete("You are a test assistant.", "Reply with OK")

        if result and len(result.strip()) > 0:
            return {"success": True, "response": result.strip()}
        else:
            return {"success": False, "error": "Empty response from model"}
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
