import base64
import os
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime

LIBREOFFICE_BIN = "/Applications/LibreOffice.app/Contents/MacOS/soffice"


def export_to_pdf(
    sections: dict,
    template_content: str | None,
    template_name: str | None,
    save_dir: str,
) -> str:
    """
    Fill edited content back into the DOCX template and export to PDF via LibreOffice.
    Falls back to plain-text DOCX → PDF if no template provided.
    """
    ext = Path(template_name).suffix.lower() if template_name else ""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_filename = f"resume_{timestamp}.pdf"
    output_path = os.path.join(save_dir, output_filename)

    if template_content and ext == ".docx":
        return _export_docx_template(sections, template_content, output_path)
    else:
        # No usable template — build a plain DOCX from sections and convert
        return _export_plain_docx(sections, output_path)


def _libreoffice_convert(docx_path: str, out_dir: str) -> str:
    """Run LibreOffice headless conversion. Returns path to generated PDF."""
    lo_cmd = LIBREOFFICE_BIN if os.path.exists(LIBREOFFICE_BIN) else "libreoffice"
    result = subprocess.run(
        [lo_cmd, "--headless", "--convert-to", "pdf", "--outdir", out_dir, docx_path],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"LibreOffice conversion failed (exit {result.returncode}):\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
    # LibreOffice names the output after the input file
    pdf_name = Path(docx_path).stem + ".pdf"
    pdf_path = os.path.join(out_dir, pdf_name)
    if not os.path.exists(pdf_path):
        raise RuntimeError(
            f"LibreOffice ran but output PDF not found at {pdf_path}.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
    return pdf_path


def _export_docx_template(sections: dict, template_content: str, output_path: str) -> str:
    """Fill content back into docx template and convert to PDF."""
    from docx import Document

    # Decode base64 data URL
    b64 = template_content.split(",", 1)[1] if "," in template_content else template_content
    template_bytes = base64.b64decode(b64)

    out_dir = os.path.dirname(output_path)

    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False, dir="/tmp") as tmp:
        tmp.write(template_bytes)
        tmp_path = tmp.name

    filled_path = tmp_path.replace(".docx", "_filled.docx")
    try:
        doc = Document(tmp_path)
        _fill_docx_sections(doc, sections)
        doc.save(filled_path)

        pdf_path = _libreoffice_convert(filled_path, out_dir)
        os.rename(pdf_path, output_path)
        return output_path
    finally:
        for p in [tmp_path, filled_path]:
            try:
                os.unlink(p)
            except FileNotFoundError:
                pass


def _export_plain_docx(sections: dict, output_path: str) -> str:
    """Build a simple DOCX from sections dict and convert to PDF."""
    from docx import Document
    from docx.shared import Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    doc = Document()

    for key, content in sections.items():
        display = key.replace("_", " ").title()
        doc.add_heading(display, level=1)

        if isinstance(content, str):
            doc.add_paragraph(content)
        elif isinstance(content, list):
            for item in content:
                if isinstance(item, str):
                    p = doc.add_paragraph(style="List Bullet")
                    p.add_run(item)
                elif isinstance(item, dict):
                    for k, v in item.items():
                        p = doc.add_paragraph()
                        p.add_run(f"{k.replace('_', ' ').title()}: ").bold = True
                        p.add_run(str(v))
        elif isinstance(content, dict):
            for k, v in content.items():
                p = doc.add_paragraph()
                p.add_run(f"{k.replace('_', ' ').title()}: ").bold = True
                p.add_run(str(v))

    out_dir = os.path.dirname(output_path)
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False, dir="/tmp") as tmp:
        tmp_path = tmp.name
    try:
        doc.save(tmp_path)
        pdf_path = _libreoffice_convert(tmp_path, out_dir)
        os.rename(pdf_path, output_path)
        return output_path
    finally:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass


def _fill_docx_sections(doc, sections: dict):
    """Replace paragraph text in docx with edited section content."""
    all_lines = []
    for content in sections.values():
        if isinstance(content, str):
            all_lines.extend(content.split("\n"))
        elif isinstance(content, list):
            for item in content:
                if isinstance(item, str):
                    all_lines.append(item)
                elif isinstance(item, dict):
                    for v in item.values():
                        if isinstance(v, str):
                            all_lines.append(v)

    line_idx = 0
    for para in doc.paragraphs:
        if para.text.strip() and line_idx < len(all_lines):
            if para.runs:
                para.runs[0].text = all_lines[line_idx]
                for run in para.runs[1:]:
                    run.text = ""
            line_idx += 1
