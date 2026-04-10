"""
pdf_exporter.py
Render a JSON Resume into an HTML/CSS template via Jinja2,
then print to PDF using Playwright's Chromium.

One-time setup after pip install:
    playwright install chromium
"""

import re
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

TEMPLATES_DIR = Path(__file__).parent / "templates"


def _render_html(
    resume: dict,
    template_name: str,
    section_order: list[str],
    active_sections: list[str],
) -> str:
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))
    template = env.get_template(f"{template_name}.html")
    return template.render(
        resume=resume,
        meta={
            "sectionOrder": section_order,
            "activeSections": active_sections,
        },
    )


def _safe_filename(name: str) -> str:
    """Strip everything except alphanumerics, spaces, hyphens, underscores."""
    return re.sub(r"[^\w\s-]", "", name).strip().replace(" ", "_") or "resume"


def export_to_pdf(
    resume: dict,
    template: str,
    section_order: list[str],
    active_sections: list[str],
    save_dir: str,
) -> str:
    """
    Render resume JSON into the named HTML/CSS template and print to PDF.
    Returns the absolute path of the saved PDF file.
    """
    html = _render_html(resume, template, section_order, active_sections)

    candidate_name = (resume.get("basics") or {}).get("name") or "resume"
    filename = f"{_safe_filename(candidate_name)}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"

    out_dir = Path(save_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    output_path = out_dir / filename

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        # set_content with domcontentloaded is enough — no external resources to wait for
        page.set_content(html, wait_until="domcontentloaded")
        page.pdf(
            path=str(output_path),
            format="Letter",
            print_background=True,
        )
        browser.close()

    return str(output_path)
