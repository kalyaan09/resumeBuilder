"""
pdf_exporter.py
Render a JSON Resume into an HTML/CSS template via Jinja2,
then print to PDF using Playwright's Chromium.

One-time setup after pip install:
    playwright install chromium
"""

import re
import sys
import os
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

# When running as a PyInstaller --onefile bundle, data files are extracted to
# sys._MEIPASS (a temp dir). Otherwise they live next to this source file.
if getattr(sys, "frozen", False):
    TEMPLATES_DIR = Path(sys._MEIPASS) / "templates"
else:
    TEMPLATES_DIR = Path(__file__).parent / "templates"

# ---------------------------------------------------------------------------
# Dummy resume used for template preview screenshots
# ---------------------------------------------------------------------------
_DUMMY_RESUME = {
    "basics": {
        "name": "Alex Johnson",
        "email": "alex.johnson@email.com",
        "phone": "(555) 867-5309",
        "location": "San Francisco, CA",
        "linkedin": "linkedin.com/in/alexjohnson",
        "github": "github.com/alexjohnson",
        "portfolio": "alexjohnson.dev",
    },
    "summary": (
        "Software Engineer with 4 years of experience building scalable distributed systems "
        "and data pipelines. Passionate about developer tooling, ML infrastructure, and "
        "open-source contributions. Led cross-functional teams shipping features used by millions."
    ),
    "experience": [
        {
            "company": "Stripe",
            "title": "Software Engineer II",
            "location": "San Francisco, CA",
            "startDate": "June 2022",
            "endDate": "Present",
            "bullets": [
                "Designed and shipped a real-time fraud detection pipeline processing 50K transactions/sec, reducing chargebacks by 23% ($4M/year saved).",
                "Led migration of legacy monolith services to Kubernetes microservices, cutting p99 latency from 800ms to 120ms.",
                "Mentored 3 junior engineers and conducted 60+ technical interviews, improving team hiring bar.",
            ],
        },
        {
            "company": "Amazon Web Services",
            "title": "Software Development Engineer",
            "location": "Seattle, WA",
            "startDate": "July 2020",
            "endDate": "May 2022",
            "bullets": [
                "Built an internal A/B testing framework adopted by 15 teams, enabling 200+ concurrent experiments.",
                "Optimized DynamoDB query patterns reducing read costs by 40% across 3 high-traffic services.",
                "Implemented CI/CD pipelines using CodePipeline and CloudFormation, cutting deploy time from 45 min to 8 min.",
            ],
        },
    ],
    "education": [
        {
            "institution": "University of California, Berkeley",
            "degree": "Bachelor of Science",
            "field": "Electrical Engineering & Computer Science",
            "endDate": "May 2020",
            "gpa": "3.8",
        }
    ],
    "skills": [
        {"category": "Languages", "items": ["Python", "Go", "Java", "TypeScript", "SQL"]},
        {"category": "Frameworks", "items": ["FastAPI", "React", "gRPC", "Kafka", "Spark"]},
        {"category": "Cloud & DevOps", "items": ["AWS", "GCP", "Kubernetes", "Terraform", "Docker"]},
        {"category": "Databases", "items": ["PostgreSQL", "DynamoDB", "Redis", "BigQuery"]},
    ],
    "projects": [
        {
            "name": "OpenTelemetry Contrib: Kafka Receiver",
            "startDate": "Jan 2023",
            "endDate": "Present",
            "bullets": [
                "Authored Kafka metrics receiver merged into the official OTel Collector contrib repo (500+ GitHub stars).",
                "Reduced instrumentation boilerplate for Kafka consumers from 200 lines to a single config block.",
            ],
        },
        {
            "name": "ResumeCraft: AI Resume Tailoring Tool",
            "startDate": "Aug 2023",
            "endDate": "Dec 2023",
            "bullets": [
                "Built a local-first Tauri + FastAPI desktop app that uses LLMs to tailor resumes to job descriptions.",
                "Integrated Playwright PDF export with 4 professional templates; used by 1,200+ job seekers.",
            ],
        },
    ],
    "certifications": [
        {"name": "AWS Certified Solutions Architect – Professional", "issuer": "Amazon", "date": "2022"},
        {"name": "Google Cloud Professional Data Engineer", "issuer": "Google", "date": "2023"},
    ],
    "publications": [],
    "awards": [
        {"title": "Hackathon 1st Place, Stripe Internal DevFest 2023", "date": "2023", "summary": "Built a real-time API cost analyzer in 24 hours."},
    ],
    "volunteer": [],
    "languages": [],
}

_DUMMY_SECTION_ORDER = [
    "summary", "experience", "education", "skills", "projects", "certifications", "awards",
]
_DUMMY_ACTIVE_SECTIONS = _DUMMY_SECTION_ORDER


def _render_html(
    resume: dict,
    template_name: str,
    section_order: list[str],
    active_sections: list[str],
    font_size: float = 10.0,
) -> str:
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))
    template = env.get_template(f"{template_name}.html")
    return template.render(
        resume=resume,
        meta={
            "sectionOrder": section_order,
            "activeSections": active_sections,
            "fontSize": font_size,
        },
    )


def render_html(
    resume: dict,
    template_name: str,
    section_order: list[str],
    active_sections: list[str],
    font_size: float = 10.0,
) -> str:
    """Public wrapper: returns rendered HTML for preview."""
    return _render_html(resume, template_name, section_order, active_sections, font_size)


def _safe_filename(name: str) -> str:
    """Strip everything except alphanumerics, spaces, hyphens, underscores."""
    return re.sub(r"[^\w\s-]", "", name).strip().replace(" ", "_") or "resume"


# One-page content height at 96dpi: (11in - 0.8in margins) × 96 = 979px
_PAGE_CONTENT_HEIGHT_PX = 979
_LETTER_W_PX = 816   # 8.5in × 96dpi, letter page width
_LETTER_H_PX = 1056  # 11in × 96dpi, letter page height


def export_to_pdf(
    resume: dict,
    template: str,
    section_order: list[str],
    active_sections: list[str],
    save_dir: str,
    font_size: float = 10.0,
    auto_fit: bool = False,
) -> tuple[str, float, str | None]:
    """
    Render resume JSON into the named HTML/CSS template and print to PDF.

    If auto_fit is True, cascades through [10, 9.5, 9]pt to find the smallest
    size that fits on one page. If nothing fits, exports at 9pt with a warning.

    Returns (absolute_path, chosen_font_size, overflow_warning_or_None).
    """
    sizes_to_try = [10.0, 9.5, 9.0] if auto_fit else [font_size]

    candidate_name = (resume.get("basics") or {}).get("name") or "resume"
    filename = f"{_safe_filename(candidate_name)}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"

    out_dir = Path(save_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    output_path = out_dir / filename

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")

        chosen_size = sizes_to_try[-1]
        chosen_html = None
        found_fit = False

        for size in sizes_to_try:
            html = _render_html(resume, template, section_order, active_sections, size)
            chosen_html = html  # keep last rendered in case nothing fits

            if auto_fit:
                # Render at exactly CONTENT_W=739px (PDF content area: 8.5in−2×0.4in = 7.7in×96dpi).
                # Using screen mode (no emulate_media) so the body flows at viewport width = 739px,
                # matching the preview iframe width exactly. Print emulation at viewport=816 can
                # re-flow at 816px before @page repaginates, giving an optimistic (too-short) height.
                chk = browser.new_page(viewport={"width": 739, "height": 1056})
                chk.set_content(html, wait_until="domcontentloaded")
                # getBoundingClientRect accounts for CSS zoom on body
                chk_rect = chk.evaluate(
                    "({'w': document.body.getBoundingClientRect().width,"
                    " 'h': document.body.getBoundingClientRect().height})"
                )
                chk.close()

                content_height = chk_rect["h"]
                if content_height <= _PAGE_CONTENT_HEIGHT_PX:
                    chosen_size = size
                    found_fit = True
                    break
            else:
                chosen_size = size
                found_fit = True
                break

        overflow_warning: str | None = None
        if auto_fit and not found_fit:
            overflow_warning = (
                "⚠️ Resume overflows to 2 pages. Consider trimming content."
            )

        # Print PDF with the chosen HTML.
        # Viewport 816×1056 = letter paper at 96dpi (8.5in × 11in).
        # @page { margin: 0.4in } constrains content area to 739px wide in print layout.
        pdf_page = browser.new_page(viewport={"width": 816, "height": 1056})
        pdf_page.emulate_media(media="print")
        pdf_page.set_content(chosen_html, wait_until="domcontentloaded")
        pdf_rect = pdf_page.evaluate(
            "({'w': document.body.getBoundingClientRect().width,"
            " 'h': document.body.getBoundingClientRect().height})"
        )
        pdf_page.pdf(
            path=str(output_path),
            format="Letter",
            print_background=True,
            prefer_css_page_size=True,
        )
        browser.close()

    return str(output_path), chosen_size, overflow_warning


def measure_content_heights(
    resumes: list[dict],
    template_name: str,
    section_order: list[str],
    active_sections: list[str],
    font_size: float = 10.0,
) -> list[float]:
    """
    Measure rendered content height (px at 96dpi) for several resume variants
    in one browser session. Fits one page when height <= PAGE_CONTENT_HEIGHT_PX.
    Same 739px-viewport heuristic as export auto-fit.
    """
    from playwright.sync_api import sync_playwright

    heights: list[float] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        try:
            page = browser.new_page(viewport={"width": 739, "height": 1056})
            for resume in resumes:
                html = _render_html(resume, template_name, section_order, active_sections, font_size)
                page.set_content(html, wait_until="domcontentloaded")
                rect = page.evaluate("document.body.getBoundingClientRect().height")
                heights.append(float(rect))
        finally:
            browser.close()
    return heights


# Exported for callers of measure_content_heights.
PAGE_CONTENT_HEIGHT_PX = _PAGE_CONTENT_HEIGHT_PX


def render_pdf_to_path(
    resume: dict,
    template_name: str,
    section_order: list[str],
    active_sections: list[str],
    output_path: str,
    font_size: float = 10.0,
) -> str | None:
    """
    Render resume HTML to PDF and save to a specific file path.

    Returns a user-facing overflow warning when a screen-layout height check
    suggests content exceeds one US Letter page at this font size (same
    heuristic as export auto-fit).
    """
    html = _render_html(resume, template_name, section_order, active_sections, font_size)

    from playwright.sync_api import sync_playwright

    overflow_warning: str | None = None

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        try:
            chk = browser.new_page(viewport={"width": 739, "height": 1056})
            chk.set_content(html, wait_until="domcontentloaded")
            chk_rect = chk.evaluate(
                "({'w': document.body.getBoundingClientRect().width,"
                " 'h': document.body.getBoundingClientRect().height})"
            )
            chk.close()
            if chk_rect["h"] > _PAGE_CONTENT_HEIGHT_PX:
                overflow_warning = (
                    "Your resume may extend past the first page. "
                    "Try a smaller font size or shorten a section."
                )

            page = browser.new_page(viewport={"width": _LETTER_W_PX, "height": _LETTER_H_PX})
            page.emulate_media(media="print")
            page.set_content(html, wait_until="domcontentloaded")
            page.pdf(
                path=output_path,
                format="Letter",
                print_background=True,
                prefer_css_page_size=True,
            )
        finally:
            browser.close()

    return overflow_warning


def render_preview_pdf_to_path(template_name: str, output_path: str) -> None:
    """Render the dummy resume for the named template and save a PDF to output_path."""
    render_pdf_to_path(
        resume=_DUMMY_RESUME,
        template_name=template_name,
        section_order=_DUMMY_SECTION_ORDER,
        active_sections=_DUMMY_ACTIVE_SECTIONS,
        output_path=output_path,
    )
