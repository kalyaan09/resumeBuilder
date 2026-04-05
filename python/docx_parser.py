import subprocess
import json
import re
from typing import Any


def parse_docx(file_path: str) -> dict:
    """Parse a .docx resume into sections dict."""
    from docx import Document

    doc = Document(file_path)
    sections: dict[str, Any] = {}
    current_section = None
    current_items: list = []

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue

        style_name = para.style.name.lower() if para.style else ""

        # Detect section headings
        is_heading = (
            "heading" in style_name
            or para.runs and any(r.bold for r in para.runs)
            and len(text) < 60
            and text.isupper() or text.istitle()
        )

        if is_heading and len(text) < 60:
            # Save previous section
            if current_section:
                sections[current_section] = _finalize_section(current_items)

            # Start new section
            current_section = _normalize_key(text)
            current_items = []
        else:
            if current_section is None:
                # Content before any heading — treat as header/contact info
                current_section = "header"
                current_items = []

            current_items.append(text)

    # Save last section
    if current_section and current_items:
        sections[current_section] = _finalize_section(current_items)

    return sections


def parse_tex(file_path: str) -> dict:
    """Extract plain text from a .tex file using pandoc, then parse sections."""
    try:
        result = subprocess.run(
            ["pandoc", file_path, "-t", "plain", "--wrap=none"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        plain_text = result.stdout
    except FileNotFoundError:
        # Pandoc not installed — do basic tex stripping
        with open(file_path, "r") as f:
            raw = f.read()
        plain_text = re.sub(r'\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})?', '', raw)
        plain_text = re.sub(r'[{}%]', '', plain_text)

    # Parse the plain text into sections
    sections: dict[str, Any] = {}
    current_section = None
    current_items: list = []

    for line in plain_text.split("\n"):
        line = line.strip()
        if not line:
            continue

        # All-caps short lines or title-case short lines are likely headings
        if (line.isupper() or (line.istitle() and len(line.split()) <= 4)) and len(line) < 50:
            if current_section:
                sections[current_section] = _finalize_section(current_items)
            current_section = _normalize_key(line)
            current_items = []
        else:
            if current_section is None:
                current_section = "header"
                current_items = []
            current_items.append(line)

    if current_section and current_items:
        sections[current_section] = _finalize_section(current_items)

    return sections


def _normalize_key(text: str) -> str:
    """Convert heading text to snake_case key."""
    key = text.lower().strip()
    key = re.sub(r'[^a-z0-9\s]', '', key)
    key = re.sub(r'\s+', '_', key)
    return key


def _finalize_section(items: list) -> Any:
    """Convert list of text items into the best data structure."""
    if not items:
        return ""

    if len(items) == 1:
        return items[0]

    # Check if items look like bullet points (short, action-verb start)
    bullet_like = sum(1 for item in items if len(item) < 200) > len(items) * 0.7
    if bullet_like:
        return items

    return "\n".join(items)
