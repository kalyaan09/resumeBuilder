"""
Critic agent — Gap 3b.
- Always runs deterministic checks first (free, sub-second)
- Only invokes LLM critic when deterministic checks fail
- LLM critic capped at MAX_LLM_ITERATIONS iterations
- Structured violation output; reviser only touches bullets that violated
"""
import copy
import json
import logging
import re
from typing import Optional

from .deterministic_validator import _collect_bullets, run_deterministic_checks
from .utils import robust_parse, invoke_llm_with_retry

log = logging.getLogger("resume")

MAX_LLM_ITERATIONS = 3

_CRITIC_SYSTEM = """You are a resume quality critic. The deterministic validator has already checked banned words, metric preservation, and weak endings.

Your job: assess whether the rewritten bullets and summary need another refinement pass based on overall quality — coherence, tone, JD alignment, and professional strength.

Return ONLY valid JSON (no commentary, no code fences):
{"requires_refinement": true, "reason": "one sentence why"}"""


_CRITIC_RETRY_PROMPT = """Your previous response failed JSON validation.

ORIGINAL INSTRUCTIONS:
{original_instructions}

YOUR PREVIOUS OUTPUT:
{raw_content}

VALIDATION ERROR:
{validation_error}

Return only valid JSON: {{"requires_refinement": true|false, "reason": "one sentence"}}. No markdown fences."""

_REVISE_SYSTEM = """You are a resume editor fixing specific violations in resume bullets.

For each bullet listed, apply ONLY the fix described. Rules:
- Fix only what is specified — do not rephrase anything else
- Preserve all metrics, numbers, and proper nouns
- Do NOT use em dashes (—); use commas or semicolons instead
- Do NOT introduce any entity not in the provided entity whitelist

Return ONLY a valid JSON array:
[{"id": "exp0.b2", "text": "fixed bullet text"}, ...]"""


def _run_llm_critic(
    resume: dict,
    original_resume: dict,
    entity_manifest: dict,
    voice_anchor: str,
    required_keywords: list[str],
    llm,
) -> dict:
    bullets = _collect_bullets(resume)
    allowed_entities = entity_manifest.get("all_entities", [])[:30]

    dynamic = (
        f"Required keywords (check if surfaced): {', '.join(required_keywords)}\n"
        f"Allowed entities: {', '.join(str(e) for e in allowed_entities)}\n\n"
        f"Voice samples (reference for tone):\n{voice_anchor}\n\n"
        f"Rewritten bullets:\n{json.dumps(bullets, indent=2)}\n\n"
        f"Summary:\n{resume.get('summary', '')}\n\n"
        "Does this resume need another refinement pass? Return JSON."
    )

    raw = None
    try:
        raw = invoke_llm_with_retry(llm.complete, _CRITIC_SYSTEM, dynamic, max_tokens=256)
        result = robust_parse(raw)
        log.info("[critic] LLM critic: requires_refinement=%s reason=%s",
                 result.get("requires_refinement"), result.get("reason", ""))
        return result
    except Exception as e:
        log.warning("[critic] LLM critic parse failed (%s) — retrying with error context", e)
        try:
            retry_dynamic = _CRITIC_RETRY_PROMPT.format(
                original_instructions=dynamic[:500],
                raw_content=raw or "",
                validation_error=str(e),
            )
            raw = invoke_llm_with_retry(llm.complete, _CRITIC_SYSTEM, retry_dynamic, max_tokens=256)
            result = robust_parse(raw)
            log.info("[critic] LLM critic retry succeeded: requires_refinement=%s reason=%s",
                     result.get("requires_refinement"), result.get("reason", ""))
            return result
        except Exception as e2:
            log.warning("[critic] LLM critic retry also failed (%s) — treating as pass", e2)
            return {"requires_refinement": False, "reason": "parse failed after retry — treating as pass"}


def _revise_violations(
    resume: dict,
    violations: list[dict],
    entity_manifest: dict,
    voice_anchor: str,
    llm,
) -> dict:
    """Revise only bullets that have violations. Returns a new resume dict."""
    result = copy.deepcopy(resume)

    # Group violations by bullet_id; skip summary and entity-level violations
    by_bullet: dict[str, list[dict]] = {}
    for v in violations:
        bid = v.get("bullet_id")
        if bid and bid != "summary" and re.match(r"(exp|proj)\d+\.b\d+", bid):
            by_bullet.setdefault(bid, []).append(v)

    if not by_bullet:
        return result

    allowed_entities = entity_manifest.get("all_entities", [])[:30]
    entity_str = ", ".join(str(e) for e in allowed_entities)

    # Build revision request
    items = []
    for bid, vios in by_bullet.items():
        m = re.match(r"(exp|proj)(\d+)\.b(\d+)", bid)
        if not m:
            continue
        kind, i, j = m.group(1), int(m.group(2)), int(m.group(3))
        block_list = result.get("experience" if kind == "exp" else "projects", [])
        if i >= len(block_list):
            continue
        bullets = block_list[i].get("bullets", [])
        if j >= len(bullets):
            continue
        items.append({
            "id": bid,
            "text": bullets[j],
            "fixes": "; ".join(v["fix"] for v in vios),
        })

    if not items:
        return result

    dynamic = (
        f"Entity whitelist: {entity_str}\n\n"
        f"Voice samples:\n{voice_anchor}\n\n"
        f"Bullets to fix:\n{json.dumps(items, indent=2)}\n\n"
        "Return fixed bullets as JSON array."
    )

    try:
        raw = invoke_llm_with_retry(llm.complete, _REVISE_SYSTEM, dynamic, max_tokens=2048)
        fixed_items = robust_parse(raw)
        id_to_text = {
            item["id"]: item["text"]
            for item in fixed_items
            if "id" in item and "text" in item
        }

        for bid, text in id_to_text.items():
            m = re.match(r"(exp|proj)(\d+)\.b(\d+)", bid)
            if not m:
                continue
            kind, i, j = m.group(1), int(m.group(2)), int(m.group(3))
            if kind == "exp":
                if i < len(result.get("experience", [])):
                    bullets = result["experience"][i].get("bullets", [])
                    if j < len(bullets):
                        result["experience"][i]["bullets"][j] = text
            else:
                if i < len(result.get("projects", [])):
                    bullets = result["projects"][i].get("bullets", [])
                    if j < len(bullets):
                        result["projects"][i]["bullets"][j] = text

    except Exception as e:
        log.warning("[critic] revise call failed (%s) — keeping current bullets", e)

    return result


def run_critic(
    resume: dict,
    original_resume: dict,
    entity_manifest: dict,
    voice_anchor: str,
    required_keywords: list[str],
    llm,
) -> tuple[dict, list[dict]]:
    """
    Run the Critic agent.

    Always runs deterministic checks first.
    Only invokes the LLM critic when deterministic checks fail.
    Capped at MAX_LLM_ITERATIONS total iterations.

    Returns (validated_resume, all_violations_found).
    """
    current = resume
    all_violations: list[dict] = []

    for iteration in range(MAX_LLM_ITERATIONS):
        det_result = run_deterministic_checks(current, original_resume, entity_manifest)
        all_violations.extend(det_result["violations"])

        if det_result["passed"]:
            log.info("[critic] iteration %d: all deterministic checks passed — skipping LLM", iteration)
            break

        log.info(
            "[critic] iteration %d: %d deterministic violation(s) — invoking LLM critic",
            iteration, len(det_result["violations"]),
        )

        llm_result = _run_llm_critic(
            current, original_resume, entity_manifest, voice_anchor, required_keywords, llm
        )
        requires_refinement = llm_result.get("requires_refinement", True)

        current = _revise_violations(current, det_result["violations"], entity_manifest, voice_anchor, llm)

        if not requires_refinement:
            log.info("[critic] iteration %d: LLM critic says no further refinement needed", iteration)
            break

    log.info("[critic] done: %d total violation(s) across all iterations", len(all_violations))
    return current, all_violations
