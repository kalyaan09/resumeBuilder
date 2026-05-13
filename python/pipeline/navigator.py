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

log = logging.getLogger("resume")

_POLISH_SYSTEM = """You are polishing resume bullets for this specific job description.

Rules:
- Lead with a strong past-tense verb; tighten phrasing; improve scanability
- Surface the provided missing_kw terms ONLY where they honestly describe the same work — never fabricate scope
- Output text MUST differ from input in at least one substantive phrase (not only punctuation); otherwise you failed the polish task
- Preserve every number, percentage, team size, and proper noun exactly as written
- Do NOT use em dashes (—); use commas or semicolons instead
- Do NOT use: leverage, leveraging, utilize, harness, foster, streamline, pivotal, spearhead, synergy, transformative

Return ONLY a valid JSON array — one object per input bullet, same count:
[{"id": "exp0.b1", "text": "polished bullet text"}, ...]"""

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

Return ONLY a valid JSON array — one object per input bullet, same count:
[{"id": "exp0.b1", "text": "rewritten bullet text"}, ...]"""

_ROUTED_SYSTEM = """You are editing resume bullets for one job description. Each input item has a "route" field:

- "polish": Tighten phrasing; surface missing_kw only where they honestly describe the same work. Preserve every number, percentage, and proper noun. Wording must change meaningfully vs input.
- "rewrite": Reframe toward the JD with the same underlying facts; do not invent tools, employers, or metrics. Wording must change meaningfully vs input.

Shared rules:
- Return ONLY a valid JSON array, same length and ids as input, in the same order.
- Do NOT use em dashes (—); use commas or semicolons.
- Do NOT use: leverage, leveraging, utilize, harness, foster, streamline, pivotal, spearhead, synergy, transformative, robust, seamless.

[{"id": "exp0.b0", "text": "..."}, ...]"""

_SUMMARY_SYSTEM = """You are rewriting the resume summary for THIS job description.

Rules:
- Open with a strong role-aligned statement; first word should be a forceful verb or concrete noun phrase — not fluff (no "Results-driven", "Passionate", "Highly motivated")
- Weave 2-4 JD themes or tools from the posting that are supported by the bullets provided — do not claim skills absent from those bullets
- Do NOT use em dashes (—) anywhere
- Do NOT use: leverage, leveraging, utilize, harness, synergy, transformative, robust, seamless
- 3-4 tight sentences; every claim must trace to the supplied experience bullets
- Think step-by-step: mentally outline {target_role, top_tools, scale/metrics}, then write flowing prose

Return ONLY the summary as a plain text string — no JSON wrapper, no code fences."""


def _strip_trailing_commas(s: str) -> str:
    return re.sub(r",(\s*[}\]])", r"\1", s)


def _extract_json_array(raw: str) -> list:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if "```" in raw:
            raw = raw.rsplit("```", 1)[0]
        raw = raw.strip()
    idx = raw.find("[")
    if idx == -1:
        raise ValueError("No JSON array found in LLM response")
    raw = raw[idx:]
    ridx = raw.rfind("]")
    if ridx == -1:
        raise ValueError("No closing ] found in LLM response")
    return json.loads(_strip_trailing_commas(raw[:ridx + 1]))


def _get_bullet_text(bullet_id: str, resume: dict) -> Optional[str]:
    m = re.match(r"exp(\d+)\.b(\d+)", bullet_id)
    if not m:
        return None
    i, j = int(m.group(1)), int(m.group(2))
    exp_list = resume.get("experience", [])
    if i >= len(exp_list):
        return None
    bullets = exp_list[i].get("bullets", [])
    return bullets[j] if j < len(bullets) else None


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

    dynamic = (
        f"{voice_block}"
        f"Entity whitelist: {entity_str}\n\n"
        f"JD context: {jd_snippet}\n\n"
        f"Bullets:\n{json.dumps(bullet_items, indent=2)}\n\n"
        "Return the JSON array."
    )

    fallback = {item["id"]: item["text"] for item in bullet_items}

    try:
        raw = llm.complete(system_prompt, dynamic, max_tokens=max_tokens)
        items = _extract_json_array(raw)
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


def _rewrite_block(
    exp_index: int,
    exp_block: dict,
    block_plans: list[BulletPlan],
    entity_manifest: dict,
    voice_anchor: str,
    jd_text: str,
    llm,
) -> list[str]:
    """Rewrite bullets for one experience block. Drops are excluded from output."""
    original_bullets = exp_block.get("bullets", [])

    plan_by_idx: dict[int, BulletPlan] = {}
    for bp in block_plans:
        m = re.match(r"exp\d+\.b(\d+)", bp.id)
        if m:
            plan_by_idx[int(m.group(1))] = bp

    # Categorise each bullet
    keeps: dict[int, str] = {}
    polishes: dict[int, tuple[str, BulletPlan]] = {}
    rewrites: dict[int, tuple[str, BulletPlan]] = {}
    ordered_indices: list[int] = []  # original order, drops excluded

    for j, bullet in enumerate(original_bullets):
        bp = plan_by_idx.get(j)
        action = bp.action if bp else "keep"

        if action == "drop":
            log.info("[navigator] DROP    exp%d.b%d: %s", exp_index, j, bullet[:80])
            continue

        ordered_indices.append(j)
        if action == "polish":
            polishes[j] = (bullet, bp)
            log.info("[navigator] POLISH  exp%d.b%d: %s", exp_index, j, bullet[:80])
        elif action == "rewrite":
            rewrites[j] = (bullet, bp)
            log.info("[navigator] REWRITE exp%d.b%d: %s", exp_index, j, bullet[:80])
        else:
            keeps[j] = bullet
            log.info("[navigator] KEEP    exp%d.b%d: %s", exp_index, j, bullet[:80])

    allowed_entities = entity_manifest.get("all_entities", [])
    entity_str = ", ".join(str(e) for e in allowed_entities[:30]) or "see resume"
    jd_snippet = jd_text[:400]

    polished_results: dict[int, str] = {}
    rewritten_results: dict[int, str] = {}

    # One LLM call when both polish and rewrite exist in this block (saves quota on Gemini free tier).
    if polishes and rewrites:
        combined: list[dict] = []
        for j in sorted(set(polishes.keys()) | set(rewrites.keys())):
            if j in polishes:
                text, bp = polishes[j]
                combined.append({
                    "id": f"exp{exp_index}.b{j}",
                    "text": text,
                    "missing_kw": bp.missing_kw if bp else [],
                    "route": "polish",
                })
            else:
                text, bp = rewrites[j]
                combined.append({
                    "id": f"exp{exp_index}.b{j}",
                    "text": text,
                    "missing_kw": bp.missing_kw if bp else [],
                    "route": "rewrite",
                })
        id_map = _llm_rewrite_bullets(
            combined, _ROUTED_SYSTEM, voice_anchor, entity_str, jd_snippet, llm, max_tokens=4096,
        )
        for j in polishes:
            polished_results[j] = id_map.get(f"exp{exp_index}.b{j}", polishes[j][0])
        for j in rewrites:
            rewritten_results[j] = id_map.get(f"exp{exp_index}.b{j}", rewrites[j][0])
    else:
        if polishes:
            items = []
            for j, (text, bp) in polishes.items():
                items.append({
                    "id": f"exp{exp_index}.b{j}",
                    "text": text,
                    "missing_kw": bp.missing_kw if bp else [],
                })
            id_map = _llm_rewrite_bullets(items, _POLISH_SYSTEM, voice_anchor, entity_str, jd_snippet, llm)
            for j in polishes:
                polished_results[j] = id_map.get(f"exp{exp_index}.b{j}", polishes[j][0])

        if rewrites:
            items = []
            for j, (text, bp) in rewrites.items():
                items.append({
                    "id": f"exp{exp_index}.b{j}",
                    "text": text,
                    "missing_kw": bp.missing_kw if bp else [],
                })
            id_map = _llm_rewrite_bullets(items, _REWRITE_SYSTEM, voice_anchor, entity_str, jd_snippet, llm)
            for j in rewrites:
                rewritten_results[j] = id_map.get(f"exp{exp_index}.b{j}", rewrites[j][0])

    # Assemble in original order (minus drops)
    final_bullets: list[str] = []
    for j in ordered_indices:
        if j in keeps:
            final_bullets.append(keeps[j])
        elif j in polishes:
            final_bullets.append(polished_results[j])
        elif j in rewrites:
            final_bullets.append(rewritten_results[j])

    return final_bullets


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


def _project_bullet_jd_score(bullet: str, jd_lower: str) -> int:
    if not isinstance(bullet, str) or not jd_lower:
        return 0
    bl = bullet.lower()
    return sum(1 for w in re.findall(r"[a-zA-Z]{3,}", jd_lower) if w in bl)


def _reorder_project_bullets_for_jd(resume: dict, jd_text: str) -> None:
    jd_lower = (jd_text or "").lower()
    if not jd_lower:
        return
    for proj in resume.get("projects") or []:
        if not isinstance(proj, dict):
            continue
        bullets = proj.get("bullets")
        if not isinstance(bullets, list) or len(bullets) < 2:
            continue
        proj["bullets"] = sorted(
            bullets,
            key=lambda x: _project_bullet_jd_score(x, jd_lower) if isinstance(x, str) else 0,
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
        "Rewrite the summary as plain text only."
    )

    try:
        raw_summary = llm.complete(_SUMMARY_SYSTEM, dynamic, max_tokens=520)
        log.info("[navigator] summary raw LLM response (%d chars): %s",
                 len(raw_summary), raw_summary[:300])
        summary_text = raw_summary.strip()
        if not summary_text.rstrip().endswith(('.', '!')):
            # truncated -- retry once with max_tokens=600
            log.info("[navigator] summary appears truncated — retrying with max_tokens=600")
            raw_summary = llm.complete(_SUMMARY_SYSTEM, dynamic, max_tokens=600)
            summary_text = raw_summary.strip()
        result = summary_text
        if result.startswith("```"):
            result = result.split("\n", 1)[1] if "\n" in result else result[3:]
            if "```" in result:
                result = result.rsplit("```", 1)[0].strip()
        if result.startswith('"') and result.endswith('"'):
            result = result[1:-1]
        log.info("[navigator] summary before post-process: %d chars | after: %d chars",
                 len(raw_summary), len(result))
        return result or original_summary
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

    # Group bullet plans by experience index
    block_plans: dict[int, list[BulletPlan]] = {}
    for bp in plan.bullet_plans:
        m = re.match(r"exp(\d+)\.", bp.id)
        if m:
            i = int(m.group(1))
            block_plans.setdefault(i, []).append(bp)

    # Collect (relevance, text) tuples for summary selection
    all_rewritten: list[tuple[float, str]] = []

    default_bp = BulletPlan(
        id="", action="keep", relevance=3, strength=3, has_numeric=False
    )

    for i, exp in enumerate(result.get("experience", [])):
        plans_for_block = {bp.id: bp for bp in block_plans.get(i, [])}
        new_bullets = _rewrite_block(
            exp_index=i,
            exp_block=exp,
            block_plans=block_plans.get(i, []),
            entity_manifest=entity_manifest,
            voice_anchor=voice_anchor,
            jd_text=jd_text,
            llm=llm,
        )
        non_drop_orig_indices = [
            orig_j
            for orig_j, bullet in enumerate(exp.get("bullets", []))
            if (plans_for_block.get(f"exp{i}.b{orig_j}") or default_bp).action != "drop"
        ]
        # JD-first ordering: most relevant bullets first within each role.
        if len(new_bullets) == len(non_drop_orig_indices) and new_bullets:
            pairs = list(zip(non_drop_orig_indices, new_bullets))
            pairs.sort(
                key=lambda p: -(plans_for_block.get(f"exp{i}.b{p[0]}") or default_bp).relevance,
            )
            ordered_bullets = [p[1] for p in pairs]
        else:
            ordered_bullets = new_bullets
            pairs = list(zip(non_drop_orig_indices, new_bullets)) if len(new_bullets) == len(non_drop_orig_indices) else []

        result["experience"][i]["bullets"] = ordered_bullets

        if pairs:
            for orig_j, bullet_text in pairs:
                bp = plans_for_block.get(f"exp{i}.b{orig_j}")
                relevance = bp.relevance if bp else 3
                all_rewritten.append((relevance, bullet_text))
        else:
            for new_j, bullet_text in enumerate(ordered_bullets):
                if new_j < len(non_drop_orig_indices):
                    orig_j = non_drop_orig_indices[new_j]
                    bp = plans_for_block.get(f"exp{i}.b{orig_j}")
                    relevance = bp.relevance if bp else 3
                else:
                    relevance = 3
                all_rewritten.append((relevance, bullet_text))

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
    _reorder_project_bullets_for_jd(result, jd_text)

    log.info("[navigator] assembled resume — keys=%s", list(result.keys()))
    log.info("[navigator] assembled resume — experience blocks=%d summary_len=%d",
             len(result.get("experience", [])),
             len(str(result.get("summary", ""))))
    for i, exp in enumerate(result.get("experience", [])):
        log.info("  exp%d: %s — %d bullets",
                 i, exp.get("company", "?"), len(exp.get("bullets", [])))
        for j, b in enumerate(exp.get("bullets", [])):
            log.debug("    exp%d.b%d: %s", i, j, b[:100])
    log.debug("[navigator] full assembled JSON: %s", json.dumps(result)[:800])

    return result
