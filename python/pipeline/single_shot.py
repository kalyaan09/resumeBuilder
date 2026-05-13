"""
Second-pass tailor: one LLM call with an explicit "visible JD alignment" mandate.

Used when the planner asked for polish/rewrite on many bullets but the navigator
left text almost unchanged (API failures, overly conservative model output, etc.).
"""

import copy
import json
import logging
import re

log = logging.getLogger("resume")

_AGGRESSIVE_TAILOR_SYSTEM = """You tailor resume JSON for ONE job description. Earlier steps barely changed the text; your output must show clear alignment with this posting.

Rules:
- Return ONLY valid JSON. Same top-level keys and structure as the input resume.
- Same counts: do not merge or split bullets; each experience block keeps the same number of bullets as the input.
- Preserve EVERY number, percentage, date, company name, school name, and proper noun from the input. Do not invent employers, products, tools, or metrics that are not already supported by the source text.
- Rewrite the summary (3–4 sentences) for THIS role: open with a concrete fit to the JD, grounded in the experience bullets.
- For each experience bullet: change wording vs the input when the work is relevant to the JD—not punctuation-only edits. Lead with a strong past-tense verb. Weave JD phrases and themes only where they truthfully describe the same work.
- Reorder bullets within a role so JD-relevant bullets are first. Reorder skills within categories for JD fit (reorder only; do not add new skill strings).
- No markdown, no code fences, no em dashes (—). Avoid: leverage, utilize, robust, seamless, transformative, synergy.

Invisible or copy-paste output is a failure."""


def _strip_code_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s[3:]
        if "```" in s:
            s = s.rsplit("```", 1)[0]
        s = s.strip()
    return s


def _extract_json_object(raw: str) -> dict:
    raw = _strip_code_fences(raw)
    if not raw.startswith("{"):
        idx = raw.find("{")
        if idx == -1:
            raise ValueError("No JSON object found in model output")
        raw = raw[idx:]
    if not raw.endswith("}"):
        idx = raw.rfind("}")
        if idx == -1:
            raise ValueError("No closing } in model output")
        raw = raw[: idx + 1]
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", raw))


def build_single_shot_dynamic(
    profile_resume: dict,
    jd_text: str,
    candidate_persona: str,
    user_instructions: str,
    transformers_context: dict,
) -> str:
    ctx_lines = []
    if transformers_context:
        kws = transformers_context.get("must_include_keywords") or []
        if kws:
            ctx_lines.append(
                "Keywords to reflect where truthful: " + ", ".join(str(x) for x in kws[:25])
            )
        dr = transformers_context.get("detected_role")
        if dr:
            ctx_lines.append(f"Detected role focus: {dr}")
    ctx = "\n".join(ctx_lines)
    ui = f"\n\nUser preferences:\n{user_instructions}" if (user_instructions or "").strip() else ""
    return (
        f"{candidate_persona}\n\n"
        f"{ctx}\n\n"
        f"Job description:\n{jd_text}\n\n"
        f"Resume JSON to tailor:\n{json.dumps(profile_resume, indent=2)}\n\n"
        f"Return the full tailored resume as one JSON object.{ui}"
    )


def run_aggressive_single_shot(
    llm,
    profile_resume: dict,
    jd_text: str,
    candidate_persona: str,
    user_instructions: str,
    transformers_context: dict,
) -> dict:
    dynamic = build_single_shot_dynamic(
        profile_resume,
        jd_text,
        candidate_persona,
        user_instructions,
        transformers_context,
    )
    raw = llm.complete(_AGGRESSIVE_TAILOR_SYSTEM, dynamic, max_tokens=8192)
    data = _extract_json_object(raw)
    if not isinstance(data, dict):
        raise ValueError("Tailor output is not a JSON object")
    return data


def apply_single_shot_over_navigator(navigated: dict, shot: dict) -> dict:
    """Replace top-level sections present in both; keeps ids and keys from navigated if shot omits them."""
    merged = copy.deepcopy(navigated)
    for k, v in shot.items():
        if k in merged and v is not None:
            merged[k] = v
    return merged
