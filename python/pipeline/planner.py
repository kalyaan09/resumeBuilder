"""
Planner agent — Gap 1b.
Produces a per-bullet edit plan (keep/polish/rewrite/drop) with routing
rules enforced deterministically after the LLM responds.
"""
import json
import re
import logging
from typing import Literal
from pydantic import BaseModel

log = logging.getLogger("resume")


class BulletPlan(BaseModel):
    id: str
    action: Literal["keep", "polish", "rewrite", "drop"]
    relevance: int       # 0-5 vs JD
    strength: int        # 0-5 standalone quality
    has_numeric: bool
    missing_kw: list[str] = []
    rationale: str = ""


class EditPlan(BaseModel):
    role_match: str = ""
    seniority: str = ""
    required_keywords: list[str] = []
    preferred_keywords: list[str] = []
    bullet_plans: list[BulletPlan] = []
    summary_instruction: str = ""


_PLANNER_SYSTEM = """You are a resume edit planner for JOB-SPECIFIC tailoring. The candidate is applying to THIS role; the resume must visibly align with the job description.

For EVERY bullet listed, output a BulletPlan. Fill relevance (0-5 JD fit), strength (0-5), has_numeric, and missing_kw BEFORE choosing action.

Tailoring stance (important):
- "keep" should be UNCOMMON. Use it only when the bullet already reflects JD language (keywords/themes) AND is tight and metric-backed.
- For relevance >= 2: default to "polish" at minimum unless the bullet is already excellent for this JD.
- Use "rewrite" when the facts are true but the framing should pivot toward this JD (still no invented work).
- Use "drop" rarely: only if the bullet is irrelevant to this JD, weak, and has no measurable outcome.

Action guide:
- keep:    Bullet already strong for THIS JD (keywords/themes present) AND high strength; changing it adds little.
- polish:  JD-relevant but wording could surface keywords, tighten, or improve scanability (DEFAULT for most relevant bullets).
- rewrite: Same facts, different emphasis to match JD; use when relevance is low-medium but experience could be reframed truthfully.
- drop:    Truly off-topic for this posting AND weak AND no numbers.

Return ONLY valid JSON (no commentary, no code fences):
{
  "role_match": "detected role from JD",
  "seniority": "entry|junior|mid|senior|staff|principal",
  "required_keywords": ["keyword1", "keyword2"],
  "preferred_keywords": ["keyword3"],
  "summary_instruction": "one sentence: what the summary rewrite should achieve",
  "bullet_plans": [
    {
      "id": "exp0.b0",
      "relevance": 4,
      "strength": 3,
      "has_numeric": true,
      "missing_kw": [],
      "action": "keep",
      "rationale": "one sentence"
    }
  ]
}"""


def _strip_trailing_commas(s: str) -> str:
    # Gemini-2.5 sometimes emits trailing commas in arrays/objects, which json.loads rejects.
    return re.sub(r",(\s*[}\]])", r"\1", s)


def _extract_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if "```" in raw:
            raw = raw.rsplit("```", 1)[0]
        raw = raw.strip()
    if not raw.startswith("{"):
        idx = raw.find("{")
        if idx == -1:
            raise ValueError("No JSON object found")
        raw = raw[idx:]
    if not raw.endswith("}"):
        idx = raw.rfind("}")
        if idx == -1:
            raise ValueError("No closing } found")
        raw = raw[:idx + 1]
    return json.loads(_strip_trailing_commas(raw))


def _has_numeric(text: str) -> bool:
    return bool(re.search(
        r'\d+(\.\d+)?\s*(%|x|X|k|K|M|B|ms|s|MAU|QPS|qps|p\d{2})|\b\d{2,}\b',
        text,
    ))


def _build_bullet_listing(profile_resume: dict) -> str:
    lines = []
    for i, exp in enumerate(profile_resume.get("experience", [])):
        lines.append(f"Experience {i}: {exp.get('title', '')} at {exp.get('company', '')}")
        for j, bullet in enumerate(exp.get("bullets", [])):
            lines.append(f"  exp{i}.b{j}: {bullet}")
    return "\n".join(lines)


def _fallback_plan(profile_resume: dict, transformers_context: dict, required_keywords: list[str]) -> EditPlan:
    bullet_plans = []
    for i, exp in enumerate(profile_resume.get("experience", [])):
        for j, bullet in enumerate(exp.get("bullets", [])):
            bullet_plans.append(BulletPlan(
                id=f"exp{i}.b{j}",
                action="keep",
                relevance=3,
                strength=3,
                has_numeric=_has_numeric(bullet),
                missing_kw=[],
                rationale="Fallback: planner parse failed",
            ))
    return EditPlan(
        role_match=transformers_context.get("detected_role", ""),
        seniority=transformers_context.get("seniority", ""),
        required_keywords=required_keywords,
        preferred_keywords=[],
        bullet_plans=bullet_plans,
        summary_instruction="Tailor the summary to match the target role and top JD keywords.",
    )


def enforce_routing_rules(plan: EditPlan) -> EditPlan:
    for bp in plan.bullet_plans:
        if bp.has_numeric and bp.action == "drop":
            bp.action = "polish"
    return plan


def _bullet_text_by_id(profile_resume: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for i, exp in enumerate(profile_resume.get("experience", [])):
        for j, bullet in enumerate(exp.get("bullets", [])):
            out[f"exp{i}.b{j}"] = bullet if isinstance(bullet, str) else ""
    return out


def _boost_for_jd_keywords(
    plan: EditPlan,
    profile_resume: dict,
    required_keywords: list[str],
) -> EditPlan:
    """Upgrade keep→polish when important JD keywords are absent from an otherwise relevant bullet."""
    if not required_keywords:
        return plan
    top_kw = [k.strip() for k in required_keywords[:15] if isinstance(k, str) and len(k.strip()) > 1]
    if not top_kw:
        return plan
    texts = _bullet_text_by_id(profile_resume)
    for bp in plan.bullet_plans:
        if bp.action != "keep":
            continue
        if bp.relevance < 2:
            continue
        t = texts.get(bp.id, "").lower()
        missing = [kw for kw in top_kw if kw.lower() not in t]
        if len(missing) >= 2 or (len(top_kw) <= 3 and missing):
            bp.action = "polish"
            merged = list(dict.fromkeys((bp.missing_kw or []) + missing))[:10]
            bp.missing_kw = merged
            bp.rationale = (bp.rationale + " [keywords: surface JD terms where truthful]").strip()[:220]
    return plan


def _ensure_minimum_tailoring(plan: EditPlan, jd_text: str) -> EditPlan:
    """If the model marked every bullet keep for a real JD, force a polish pass on the strongest half."""
    jd = (jd_text or "").strip()
    if len(jd) < 120:
        return plan
    if not plan.bullet_plans:
        return plan
    if any(bp.action in ("polish", "rewrite", "drop") for bp in plan.bullet_plans):
        return plan
    ranked = sorted(
        enumerate(plan.bullet_plans),
        key=lambda x: (-x[1].relevance, -x[1].strength, -int(x[1].has_numeric)),
    )
    n = max(1, (len(ranked) + 1) // 2)
    for _, bp in ranked[:n]:
        bp.action = "polish"
        bp.rationale = (bp.rationale + " [minimum tailoring pass]").strip()[:220]
    log.warning("[planner] all-keep plan overridden: upgraded %d bullets to polish for JD alignment", n)
    return plan


def finalize_plan(
    plan: EditPlan,
    profile_resume: dict,
    jd_text: str,
    required_keywords: list[str],
) -> EditPlan:
    plan = enforce_routing_rules(plan)
    plan = _boost_for_jd_keywords(plan, profile_resume, required_keywords)
    plan = _ensure_minimum_tailoring(plan, jd_text)
    return plan


def run_planner(
    profile_resume: dict,
    basics: dict,
    jd_text: str,
    transformers_context: dict,
    candidate_persona: str,
    required_keywords: list[str],
    llm,
) -> EditPlan:
    bullet_listing = _build_bullet_listing(profile_resume)
    keywords_str = ", ".join(required_keywords) if required_keywords else "see JD"

    dynamic = (
        f"{candidate_persona}\n\n"
        f"Priority JD keywords to surface: {keywords_str}\n\n"
        f"Job Description:\n{jd_text}\n\n"
        f"Resume bullets to plan:\n{bullet_listing}\n\n"
        "Return the complete edit plan as JSON."
    )
    model_id = (getattr(llm, "model", None) or "").lower()
    if "gemma" in model_id:
        dynamic += (
            "\n\nCRITICAL for Gemma: Reply with exactly one JSON object. "
            "The first non-whitespace character must be {. No analysis, headings, or bullet lists before or after the JSON."
        )

    try:
        raw = llm.complete(_PLANNER_SYSTEM, dynamic, max_tokens=8192)
        log.debug("[planner] raw LLM response (%d chars):\n%s", len(raw), raw[:2000])
        data = _extract_json(raw)
    except Exception as e:
        log.warning("[planner] LLM call or parse failed (%s) — using keep-all fallback", e)
        fb = _fallback_plan(profile_resume, transformers_context, required_keywords)
        merged_fb_kw = list(dict.fromkeys([*(required_keywords or []), *(fb.required_keywords or [])]))
        return finalize_plan(fb, profile_resume, jd_text, merged_fb_kw)

    # Parse bullet plans from LLM output
    bullet_plans: list[BulletPlan] = []
    for bp_data in data.get("bullet_plans", []):
        try:
            bullet_plans.append(BulletPlan(
                id=bp_data.get("id", ""),
                action=bp_data.get("action", "keep"),
                relevance=max(0, min(5, int(bp_data.get("relevance", 3)))),
                strength=max(0, min(5, int(bp_data.get("strength", 3)))),
                has_numeric=bool(bp_data.get("has_numeric", False)),
                missing_kw=bp_data.get("missing_kw", []),
                rationale=bp_data.get("rationale", ""),
            ))
        except Exception as e:
            log.warning("[planner] skipping malformed BulletPlan entry: %s", e)

    # Fill in any bullets the LLM missed — default to keep
    planned_ids = {bp.id for bp in bullet_plans}
    for i, exp in enumerate(profile_resume.get("experience", [])):
        for j, bullet in enumerate(exp.get("bullets", [])):
            bid = f"exp{i}.b{j}"
            if bid not in planned_ids:
                log.warning("[planner] LLM missed bullet %s — defaulting to keep", bid)
                bullet_plans.append(BulletPlan(
                    id=bid,
                    action="keep",
                    relevance=3,
                    strength=3,
                    has_numeric=_has_numeric(bullet),
                    missing_kw=[],
                    rationale="Not included in LLM plan — defaulting to keep",
                ))

    plan = EditPlan(
        role_match=data.get("role_match", ""),
        seniority=data.get("seniority", ""),
        required_keywords=data.get("required_keywords", required_keywords),
        preferred_keywords=data.get("preferred_keywords", []),
        bullet_plans=bullet_plans,
        summary_instruction=data.get("summary_instruction", "Tailor the summary to the target role."),
    )

    log.info("[planner] plan parsed: %d bullets, role=%s, seniority=%s",
             len(plan.bullet_plans), plan.role_match, plan.seniority)
    log.info("[planner] per-bullet LLM decisions:")
    for bp in plan.bullet_plans:
        log.info(
            "  %s  rel=%d str=%d numeric=%s  action=%s  rationale=%s",
            bp.id, bp.relevance, bp.strength, bp.has_numeric, bp.action,
            bp.rationale[:80] if bp.rationale else "",
        )

    merged_kw = list(dict.fromkeys([*(required_keywords or []), *(plan.required_keywords or [])]))
    return finalize_plan(plan, profile_resume, jd_text, merged_kw)
