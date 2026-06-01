"""
Navigator agent — Gaps 2a–2d.
- Index-locked output: bullet count in == bullet count out per block
- Voice anchor injected into every rewrite call
- Separate prompts for polish vs rewrite routes
- keep route skips LLM entirely
- Summary runs last, fed by top 5 rewritten bullets by relevance
"""
import copy
import json
import re
import logging
from typing import Optional

from .planner import EditPlan, BulletPlan
from .utils import robust_parse, invoke_llm_with_retry

log = logging.getLogger("resume")

_POLISH_SYSTEM = """You are polishing resume bullets for this specific job description.

Rules:
- Lead with a strong past-tense verb; tighten phrasing; improve scanability
- Surface the provided missing_kw terms ONLY where they honestly describe the same work — never fabricate scope
- Output text MUST differ from input in at least one substantive phrase (not only punctuation); otherwise you failed the polish task
- Preserve every number, percentage, team size, and proper noun exactly as written
- Do NOT use em dashes (—); use commas or semicolons instead
- Do NOT use: leverage, leveraging, utilize, harness, foster, streamline, pivotal, spearhead, synergy, transformative

Return ONLY a valid JSON array wrapped in [OUTPUT_ONLY_JSON] tags — one object per input bullet, same count:
[OUTPUT_ONLY_JSON]
[{"id": "exp0.b1", "text": "polished bullet text"}, ...]
[OUTPUT_ONLY_JSON]"""

_REWRITE_SYSTEM = """You are rewriting resume bullets for better job description alignment.

Rules:
- Keep the underlying activity and ALL quantitative results — new phrasing OK, new facts NOT OK; the rewritten bullet MUST NOT be a near-duplicate of the input
- Do NOT introduce tools or skills that are not in the entity whitelist provided
- If a JD keyword cannot be supported by this experience, skip it — never fabricate; set the text as close to the original as possible instead
- Do NOT use em dashes (—); use commas or semicolons instead
- Do NOT use: leverage, leveraging, utilize, harness, foster, streamline, pivotal, spearhead

<example>
  Input: "Built distributed search in Go using Elasticsearch serving 50K QPS."
  JD keywords: ["Python", "AWS"]
  Output: "Built distributed search in Go using Elasticsearch serving 50K QPS."
  Why: JD keywords not supported by this experience. Metric present — leave intact.
</example>

<example>
  Input: "Worked on data pipeline improvements."
  JD keywords: ["Apache Kafka", "throughput"]
  Output: "Improved data pipeline throughput 3x by migrating batch jobs to event-driven streaming with Apache Kafka."
  Why: Rewrite OK — no specific metric in original, JD keyword fits the activity.
</example>

Return ONLY a valid JSON array wrapped in [OUTPUT_ONLY_JSON] tags — one object per input bullet, same count:
[OUTPUT_ONLY_JSON]
[{"id": "exp0.b1", "text": "rewritten bullet text"}, ...]
[OUTPUT_ONLY_JSON]"""

_ROUTED_SYSTEM = """You are editing resume bullets for one job description. Each input item has a "route" field and a "missing_kw" list.

- "polish": Tighten phrasing and scanability. Surface terms from missing_kw ONLY where they honestly describe the same work — never fabricate scope. Preserve every number, percentage, and proper noun. Wording must change meaningfully vs input.
- "rewrite": Reframe toward the JD with the same underlying facts. Where missing_kw terms fit the actual work, weave them in naturally; skip any that don't fit — do not invent tools, employers, or metrics. Wording must change meaningfully vs input.

The missing_kw field tells you which JD keywords are absent from the bullet. Your goal is to surface as many as honestly apply.

Shared rules:
- Return ONLY a valid JSON array wrapped in [OUTPUT_ONLY_JSON] tags, same length and ids as input, in the same order.
- Do NOT use em dashes (—); use commas or semicolons.
- Do NOT use: leverage, leveraging, utilize, harness, foster, streamline, pivotal, spearhead, synergy, transformative, robust, seamless.

Example:
[OUTPUT_ONLY_JSON]
[{"id": "exp0.b0", "text": "..."}, ...]
[OUTPUT_ONLY_JSON]"""

_SUMMARY_SYSTEM = """You are rewriting the resume summary for THIS job description.

Rules:
- Open with a strong, role-aligned identity statement (e.g. "Software Engineer with experience building...")
- Weave 2-4 specific JD themes or tools from the posting that are supported by the bullets provided
- Every claim must be factually supported by the top bullets provided below — do not claim skills or years absent from those bullets
- Wording must be tight, professional, and impactful. Avoid fluff like "passionate", "results-driven", or "dedicated"
- Length: Exactly 3 or 4 sentences. Never write a fifth sentence. Target 380–480 characters total.
- Do NOT use bullet points or line breaks — one continuous paragraph only
- Do NOT use em dashes (—); use commas or semicolons
- Do NOT use: leverage, leveraging, utilize, harness, synergy, transformative, robust, seamless

Return ONLY the summary as plain prose — no JSON, no code fences, no checklists, no commentary."""


def _clamp_summary(text: str, max_sentences: int = 4, max_chars: int = 500) -> str:
    """Keep summaries to 3–4 sentences so the PDF stays one tight block."""
    text = re.sub(r"\s+", " ", (text or "").strip())
    if not text:
        return text
    parts = re.split(r"(?<=[.!?])\s+", text)
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) > max_sentences:
        parts = parts[:max_sentences]
    text = " ".join(parts)
    if text and not text.rstrip().endswith((".", "!", "?")):
        text = text.rstrip(".,;:") + "."
    if len(text) > max_chars:
        cut = text[:max_chars].rsplit(" ", 1)[0]
        text = cut.rstrip(".,;:") + "."
    return text


def _get_bullet_text(bullet_id: str, resume: dict) -> Optional[str]:
    m = re.match(r"(exp|proj)(\d+)\.b(\d+)", bullet_id)
    if not m:
        return None
    kind, i, j = m.group(1), int(m.group(2)), int(m.group(3))
    block_list = resume.get("experience" if kind == "exp" else "projects", [])
    if i >= len(block_list):
        return None
    bullets = block_list[i].get("bullets", [])
    if not isinstance(bullets, list) or j >= len(bullets):
        return None
    return bullets[j]


def build_voice_anchor(profile_resume: dict, bullet_plans: list[BulletPlan]) -> str:
    top_keep = sorted(
        [bp for bp in bullet_plans if bp.action == "keep"],
        key=lambda x: x.strength,
        reverse=True,
    )[:3]
    samples = []
    for bp in top_keep:
        text = _get_bullet_text(bp.id, profile_resume)
        if text:
            samples.append(f"- {text}")

    if not samples:
        # Fall back to the highest-strength original bullets for tone reference
        all_bullets = []
        for bp in sorted(bullet_plans, key=lambda x: x.strength, reverse=True):
            text = _get_bullet_text(bp.id, profile_resume)
            if text:
                all_bullets.append(f"- {text}")
            if len(all_bullets) >= 3:
                break
        samples = all_bullets

    return "\n".join(samples)


def _llm_rewrite_bullets(
    bullet_items: list[dict],
    system_prompt: str,
    voice_anchor: str,
    entity_str: str,
    jd_snippet: str,
    llm,
    max_tokens: int = 2048,
) -> dict[str, str]:
    """
    Call LLM with a batch of bullets. Returns {id: rewritten_text}.
    Falls back to original text (from bullet_items) on any failure.
    """
    voice_block = (
        f"\n<voice_samples>\n{voice_anchor}\n</voice_samples>\n"
        "Match the tone, rhythm, and terseness of these samples exactly.\n\n"
        if voice_anchor else ""
    )

    model_id = (getattr(llm, "model", None) or "").lower()
    gemma_hint = ""
    if "gemma" in model_id:
        gemma_hint = (
            "CRITICAL for Gemma: Output ONLY the JSON block. Do not analyze. Do not explain. "
            "Your response must contain exactly the [OUTPUT_ONLY_JSON] tags with JSON in between.\n\n"
        )

    dynamic = (
        f"{gemma_hint}"
        f"{voice_block}"
        f"Entity whitelist: {entity_str}\n\n"
        f"JD context: {jd_snippet}\n\n"
        f"Bullets:\n{json.dumps(bullet_items, indent=2)}\n\n"
        "Return the JSON array wrapped in [OUTPUT_ONLY_JSON] tags."
    )

    fallback = {item["id"]: item["text"] for item in bullet_items}

    try:
        raw = invoke_llm_with_retry(llm.complete, system_prompt, dynamic, max_tokens=max_tokens)
        items = robust_parse(raw)
        result = {item["id"]: item["text"] for item in items if "id" in item and "text" in item}

        input_ids = set(fallback.keys())
        output_ids = set(result.keys())
        if output_ids != input_ids:
            log.warning(
                "[navigator] ID drift — missing=%s extra=%s",
                input_ids - output_ids,
                output_ids - input_ids,
            )
        # For any missing ID, fall back to original
        for bid, orig in fallback.items():
            result.setdefault(bid, orig)

        return result
    except Exception as e:
        log.warning("[navigator] LLM rewrite call failed (%s) — keeping originals", e)
        return fallback


def _categorize_block(
    block_index: int,
    block: dict,
    block_plans: list[BulletPlan],
    prefix: str = "exp",
) -> tuple[dict, dict, dict, list[int]]:
    """
    Categorize bullets for one block (experience or project). No LLM calls.
    Returns (keeps, polishes, rewrites, ordered_indices) where drops are excluded.
    """
    original_bullets = block.get("bullets", [])
    plan_by_idx: dict[int, BulletPlan] = {}
    for bp in block_plans:
        m = re.match(rf"{prefix}\d+\.b(\d+)", bp.id)
        if m:
            plan_by_idx[int(m.group(1))] = bp

    keeps: dict[int, str] = {}
    polishes: dict[int, tuple[str, BulletPlan]] = {}
    rewrites: dict[int, tuple[str, BulletPlan]] = {}
    ordered_indices: list[int] = []

    for j, bullet in enumerate(original_bullets):
        bp = plan_by_idx.get(j)
        action = bp.action if bp else "keep"

        if action == "drop":
            log.info("[navigator] DROP    %s%d.b%d: %s", prefix, block_index, j, bullet[:80])
            continue

        ordered_indices.append(j)
        if action == "polish":
            polishes[j] = (bullet, bp)
            log.info("[navigator] POLISH  %s%d.b%d: %s", prefix, block_index, j, bullet[:80])
        elif action == "rewrite":
            rewrites[j] = (bullet, bp)
            log.info("[navigator] REWRITE %s%d.b%d: %s", prefix, block_index, j, bullet[:80])
        else:
            keeps[j] = bullet
            log.info("[navigator] KEEP    %s%d.b%d: %s", prefix, block_index, j, bullet[:80])

    return keeps, polishes, rewrites, ordered_indices


def _skill_line_jd_score(item: str, jd_lower: str) -> int:
    if not isinstance(item, str) or not jd_lower:
        return 0
    s = item.lower()
    return sum(
        1
        for tok in re.findall(r"[a-zA-Z][a-zA-Z0-9+.#\-]*", s)
        if len(tok) > 2 and tok in jd_lower
    )


def _reorder_skills_for_jd(resume: dict, jd_text: str) -> None:
    """Within each skill category, put JD-aligned items first (no new skills added)."""
    jd_lower = (jd_text or "").lower()
    if not jd_lower:
        return
    skills = resume.get("skills")
    if not isinstance(skills, list):
        return
    for cat in skills:
        items = cat.get("items")
        if not isinstance(items, list) or len(items) < 2:
            continue
        cat["items"] = sorted(
            items,
            key=lambda x: _skill_line_jd_score(x, jd_lower) if isinstance(x, str) else 0,
            reverse=True,
        )


def _rewrite_summary(
    original_summary: str,
    top_bullets: list[str],
    plan: EditPlan,
    candidate_persona: str,
    jd_text: str,
    llm,
) -> str:
    dynamic = (
        f"{candidate_persona}\n\n"
        f"Summary instruction: {plan.summary_instruction}\n"
        f"Target role: {plan.role_match} ({plan.seniority})\n\n"
        f"Top rewritten experience bullets (use these as the factual basis for claims):\n"
        + "\n".join(f"- {b}" for b in top_bullets)
        + f"\n\nOriginal summary:\n{original_summary}\n\n"
        f"Job description context:\n{jd_text[:400]}\n\n"
        "Rewrite the summary: exactly 3 or 4 sentences, one paragraph, under 480 characters."
    )

    def _looks_like_reasoning(text: str) -> bool:
        markers = ("yes\n", "no\n", "checked", "* ", "- [", "role-aligned", "em dash")
        lower = text.lower()
        return any(m in lower for m in markers) or text.count("\n") > 2

    def _clean_summary(raw: str) -> str:
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if "```" in text:
                text = text.rsplit("```", 1)[0].strip()
        if text.startswith('"') and text.endswith('"'):
            text = text[1:-1]
        text = re.sub(r"\s+", " ", text.strip())
        return _clamp_summary(text)

    try:
        raw_summary = invoke_llm_with_retry(llm.complete, _SUMMARY_SYSTEM, dynamic, max_tokens=480)
        log.info("[navigator] summary attempt 1 (%d chars): %s", len(raw_summary), raw_summary[:200])
        candidate = _clean_summary(raw_summary)

        needs_retry = (
            not candidate.rstrip().endswith((".", "!", "?"))
            or _looks_like_reasoning(candidate)
            or len(candidate) < 120
            or len(re.split(r"(?<=[.!?])\s+", candidate)) > 4
        )
        if needs_retry:
            log.info("[navigator] summary needs retry (truncated=%s reasoning=%s len=%d)",
                     not candidate.rstrip().endswith((".", "!", "?")), _looks_like_reasoning(candidate), len(candidate))
            raw_summary2 = invoke_llm_with_retry(llm.complete, _SUMMARY_SYSTEM, dynamic, max_tokens=520)
            candidate2 = _clean_summary(raw_summary2)
            log.info("[navigator] summary attempt 2 (%d chars): %s", len(candidate2), candidate2[:200])
            if not _looks_like_reasoning(candidate2) and len(candidate2) >= max(120, len(candidate) - 40):
                candidate = candidate2

        candidate = _clamp_summary(candidate)
        log.info("[navigator] summary final: %d chars", len(candidate))
        return candidate or original_summary
    except Exception as e:
        log.warning("[navigator] summary rewrite failed (%s) — keeping original", e)
        return original_summary


def run_navigator(
    profile_resume: dict,
    plan: EditPlan,
    entity_manifest: dict,
    candidate_persona: str,
    jd_text: str,
    llm,
) -> dict:
    """
    Run the Navigator agent. Returns a new profile_resume with rewritten
    bullets and summary. Modifies a deep copy — never mutates the original.
    """
    result = copy.deepcopy(profile_resume)

    voice_anchor = build_voice_anchor(profile_resume, plan.bullet_plans)

    # Group bullet plans by prefix and index
    exp_block_plans: dict[int, list[BulletPlan]] = {}
    proj_block_plans: dict[int, list[BulletPlan]] = {}
    for bp in plan.bullet_plans:
        m = re.match(r"(exp|proj)(\d+)\.", bp.id)
        if m:
            kind, i = m.group(1), int(m.group(2))
            if kind == "exp":
                exp_block_plans.setdefault(i, []).append(bp)
            else:
                proj_block_plans.setdefault(i, []).append(bp)

    # Pass 1: categorize all blocks — no LLM calls yet
    exp_block_data: list[tuple] = []
    proj_block_data: list[tuple] = []
    all_items: list[dict] = []

    for i, exp in enumerate(result.get("experience", [])):
        keeps, polishes, rewrites, ordered_indices = _categorize_block(
            i, exp, exp_block_plans.get(i, []), prefix="exp"
        )
        exp_block_data.append((i, keeps, polishes, rewrites, ordered_indices))
        for j, (text, bp) in polishes.items():
            all_items.append({"id": f"exp{i}.b{j}", "text": text, "missing_kw": bp.missing_kw, "route": "polish"})
        for j, (text, bp) in rewrites.items():
            all_items.append({"id": f"exp{i}.b{j}", "text": text, "missing_kw": bp.missing_kw, "route": "rewrite"})

    for i, proj in enumerate(result.get("projects", [])):
        keeps, polishes, rewrites, ordered_indices = _categorize_block(
            i, proj, proj_block_plans.get(i, []), prefix="proj"
        )
        proj_block_data.append((i, keeps, polishes, rewrites, ordered_indices))
        for j, (text, bp) in polishes.items():
            all_items.append({"id": f"proj{i}.b{j}", "text": text, "missing_kw": bp.missing_kw, "route": "polish"})
        for j, (text, bp) in rewrites.items():
            all_items.append({"id": f"proj{i}.b{j}", "text": text, "missing_kw": bp.missing_kw, "route": "rewrite"})

    # ONE LLM call for all bullets across all blocks
    entity_str = ", ".join(str(e) for e in entity_manifest.get("all_entities", [])[:30]) or "see resume"
    jd_snippet = jd_text[:800]
    if all_items:
        log.info("[navigator] single batch call: %d bullets across %d blocks", len(all_items), len(exp_block_data) + len(proj_block_data))
        id_map = _llm_rewrite_bullets(
            all_items, _ROUTED_SYSTEM, voice_anchor, entity_str, jd_snippet, llm, max_tokens=6144,
        )
    else:
        id_map = {}

    # Pass 2: assemble each block from the global id_map
    all_rewritten: list[tuple[int, str]] = []
    default_bp = BulletPlan(id="", action="keep", relevance=3, strength=3, has_numeric=False)

    # Experience blocks
    for i, keeps, polishes, rewrites, ordered_indices in exp_block_data:
        plans_for_block = {bp.id: bp for bp in exp_block_plans.get(i, [])}
        assembled: list[str] = []
        for j in ordered_indices:
            if j in keeps: assembled.append(keeps[j])
            elif j in polishes: assembled.append(id_map.get(f"exp{i}.b{j}", polishes[j][0]))
            elif j in rewrites: assembled.append(id_map.get(f"exp{i}.b{j}", rewrites[j][0]))

        if assembled:
            pairs = []
            for j, text in zip(ordered_indices, assembled):
                bp = plans_for_block.get(f"exp{i}.b{j}") or default_bp
                pairs.append((bp.relevance, text))
            pairs.sort(key=lambda x: -x[0])
            ordered_bullets = [p[1] for p in pairs]
            result["experience"][i]["bullets"] = ordered_bullets
            all_rewritten.extend(pairs)

    # Project blocks
    for i, keeps, polishes, rewrites, ordered_indices in proj_block_data:
        plans_for_block = {bp.id: bp for bp in proj_block_plans.get(i, [])}
        assembled: list[str] = []
        for j in ordered_indices:
            if j in keeps: assembled.append(keeps[j])
            elif j in polishes: assembled.append(id_map.get(f"proj{i}.b{j}", polishes[j][0]))
            elif j in rewrites: assembled.append(id_map.get(f"proj{i}.b{j}", rewrites[j][0]))

        if assembled:
            pairs = []
            for j, text in zip(ordered_indices, assembled):
                bp = plans_for_block.get(f"proj{i}.b{j}") or default_bp
                pairs.append((bp.relevance, text))
            pairs.sort(key=lambda x: -x[0])
            ordered_bullets = [p[1] for p in pairs]
            result["projects"][i]["bullets"] = ordered_bullets
            all_rewritten.extend(pairs)

    # Summary runs LAST — fed by top 5 bullets by relevance
    top_bullets = [
        text for _, text in sorted(all_rewritten, key=lambda x: x[0], reverse=True)[:5]
    ]

    result["summary"] = _rewrite_summary(
        original_summary=profile_resume.get("summary", ""),
        top_bullets=top_bullets,
        plan=plan,
        candidate_persona=candidate_persona,
        jd_text=jd_text,
        llm=llm,
    )

    _reorder_skills_for_jd(result, jd_text)

    log.info("[navigator] assembled resume — keys=%s, exp_blocks=%d, proj_blocks=%d",
             list(result.keys()), len(result.get("experience", [])), len(result.get("projects", [])))
    return result
