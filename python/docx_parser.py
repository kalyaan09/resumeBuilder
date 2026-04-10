import subprocess
import json
import logging
import re
from typing import Any

log = logging.getLogger("resume")

# Pure-structure lines that carry no user content
_SKIP = re.compile(
    r"\\(?:begin|end|vspace|hspace|hrule|noindent|newcommand|def|"
    r"resumeSubHeadingListStart|resumeSubHeadingListEnd|"
    r"resumeItemListStart|resumeItemListEnd|"
    r"vfill|medskip|smallskip|bigskip|clearpage|newpage)\b"
)

# Lines that break a multi-line \item continuation
_ITEM_BREAK = re.compile(
    r"\\(?:item|begin|end|vspace|hspace|hrule|noindent|newcommand|def|"
    r"resumeSubHeadingListStart|resumeSubHeadingListEnd|"
    r"resumeItemListStart|resumeItemListEnd|"
    r"vfill|medskip|smallskip|bigskip|clearpage|newpage|\w*[Ss]ection)\b"
)


def _iter_all_doc_paragraphs(doc):
    """
    Yield every paragraph in document order, including paragraphs inside table
    cells (which doc.paragraphs misses). Merged cells are visited only once.
    """
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph
    from docx.table import Table

    seen_tc: set[int] = set()

    def _walk(parent_elm, parent):
        for child in parent_elm.iterchildren():
            if child.tag == qn("w:p"):
                yield Paragraph(child, parent)
            elif child.tag == qn("w:tbl"):
                tbl = Table(child, parent)
                for row in tbl.rows:
                    for cell in row.cells:
                        tc = cell._tc
                        if id(tc) in seen_tc:
                            continue
                        seen_tc.add(id(tc))
                        yield from _walk(tc, cell)

    yield from _walk(doc.element.body, doc)


def parse_docx(file_path: str) -> dict:
    """Parse a .docx resume into sections dict."""
    from docx import Document

    doc = Document(file_path)
    sections: dict[str, Any] = {}
    current_section = None
    current_items: list = []

    for para in _iter_all_doc_paragraphs(doc):
        text = para.text.strip()
        if not text:
            continue

        style_name = para.style.name.lower() if para.style else ""

        # Detect section headings
        is_heading = (
            "heading" in style_name
            or (
                para.runs
                and any(r.bold for r in para.runs)
                and len(text) < 60
                and (text.isupper() or text.istitle())
            )
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
    """
    Parse a .tex resume into a sections dict by extracting text directly from
    the LaTeX source — no pandoc.  Extracting from {…} arguments means every
    returned string appears verbatim in the source file, so the export step can
    find and replace them without any normalisation round-trips.
    """
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        source = f.read()
    result = _parse_tex_source(source)

    log.info("="*80)
    log.info("PARSE-TEX — EXTRACTED SECTIONS")
    log.info("="*80)
    log.info(json.dumps(result, indent=2))
    log.info("="*80)

    return result


def _join_multiline_items(lines: list[str]) -> list[str]:
    """Join continuation lines of \\item blocks into a single line."""
    result: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if re.match(r"\\item\b", line):
            parts = [line]
            i += 1
            while i < len(lines):
                next_line = lines[i]
                if not next_line or _ITEM_BREAK.match(next_line):
                    break
                parts.append(next_line)
                i += 1
            result.append(" ".join(parts))
        else:
            result.append(line)
            i += 1
    return result


def _parse_tex_source(source: str) -> dict:
    # Strip comments
    source = re.sub(r"%[^\n]*", "", source)

    # Work only on the document body
    m = re.search(r"\\begin\{document\}", source)
    body = source[m.end():] if m else source

    sections: dict[str, Any] = {}
    current_section: str | None = None
    current_items: list[str] = []

    lines = [l.strip() for l in body.split("\n")]
    lines = _join_multiline_items(lines)

    for line in lines:
        if not line:
            continue

        # Section heading  (\section, \cvsection, \resumesection, …)
        sec = re.match(r"\\(?:\w*[Ss]ection)\*?\{([^}]+)\}", line)
        if sec:
            if current_section and current_items:
                sections[current_section] = _finalize_section(current_items)
            current_section = _normalize_key(sec.group(1))
            current_items = []
            continue

        if _SKIP.match(line):
            continue

        # Extract human-readable text from this line
        texts = _tex_line_content(line)
        current_items.extend(texts)

    if current_section and current_items:
        sections[current_section] = _finalize_section(current_items)

    # Fall back to header section for anything before the first \section
    if not sections:
        sections["header"] = _finalize_section(current_items)

    return sections


def _tex_line_content(line: str) -> list[str]:
    """
    Return the human-readable strings on one LaTeX line.
    We extract text from {…} arguments directly so the strings appear verbatim
    in the source and can be located for replacement.
    """
    results: list[str] = []

    # Skills row: \textbf{Label} & Value  — return as "Label: Value"
    m = re.match(r"\\textbf\{([^}]+)\}\s*&\s*(.+)", line)
    if m:
        label = m.group(1).strip()
        value = re.sub(r"\s*\\\\?\s*$", "", m.group(2)).strip()
        return [f"{label}: {value}"]

    # \item text  (standard bullets)
    # Keep raw — do NOT strip inline LaTeX commands here. The raw text after
    # \item appears verbatim in the source, so _tex_replace can find and
    # replace it. Cleaning would break the verbatim match.
    m = re.match(r"\\item\s+(.+)", line)
    if m:
        text = m.group(1).strip()
        if text:
            results.append(text)
        return results

    # Extract all top-level {…} argument values from the line
    # We only go one level deep to stay literal with the source
    for arg in re.findall(r"\{([^{}]+)\}", line):
        arg = arg.strip()
        # Skip: LaTeX sub-commands, pure numbers/units, very short tokens
        if (
            arg
            and len(arg) > 3
            and not arg.startswith("\\")
            and not re.fullmatch(r"[\d\s.,;:]+", arg)
            and not re.fullmatch(r"\d+(?:pt|em|cm|mm|ex|in|bp)", arg)
            and not re.fullmatch(r"[A-Z][a-z]?\d*", arg)  # e.g. "T1", "OT1"
        ):
            results.append(arg)

    return results


def _clean_inline_tex(text: str) -> str:
    r"""Strip simple inline commands (\textbf, \textit, \href) leaving plain text."""
    text = re.sub(r"\\textbf\{([^}]+)\}", r"\1", text)
    text = re.sub(r"\\textit\{([^}]+)\}", r"\1", text)
    text = re.sub(r"\\emph\{([^}]+)\}", r"\1", text)
    text = re.sub(r"\\href\{[^}]+\}\{([^}]+)\}", r"\1", text)
    text = re.sub(r"\\[a-zA-Z]+\b", "", text)
    text = re.sub(r"[{}]", "", text)
    return text.strip()


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
