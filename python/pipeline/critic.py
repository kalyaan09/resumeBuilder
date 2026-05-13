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

log = logging.getLogger("resume")

MAX_LLM_ITERATIONS = 3

_CRITIC_SYSTEM = """You are a resume quality critic. Review the rewritten resume bullets and summary for specific violations.

Run all three passes and report every violation found:

1. BANNED_WORD — any of: leverage, leveraging, delve, robust, seamless, utilize, utilise, harness, foster, streamline, pivotal, spearhead, synergy, transformative, meticulous, garner, embark, cutting-edge
2. FAITHFULNESS — did the rewrite lose technical details, specific metrics, or proper nouns that were in the original?
3. WEAK_ENDING — bullets that trail off without a result, impact, or outcome statement

Return ONLY valid JSON (no commentary, no code fences):
{
  "violations": [
    {
      "rule": "BANNED_WORD|FAITHFULNESS|WEAK_ENDING",
      "bullet_id": "exp0.b2",
      "span": "the exact offending text",
      "fix": "specific actionable fix — not 'improve this'"
    }
  ],
  "missing_keywords": ["keyword not surfaced anywhere"],
  "overall_pass": true
}"""

_REVISE_SYSTEM = """You are a resume editor fixing specific violations in resume bullets.

For each bullet listed, apply ONLY the fix described. Rules:
- Fix only what is specified — do not rephrase anything else
- Preserve all metrics, numbers, and proper nouns
- Do NOT use em dashes (—); use commas or semicolons instead
- Do NOT introduce any entity not in the provided entity whitelist

Return ONLY a valid JSON array:
[{"id": "exp0.b2", "text": "fixed bullet text"}, ...]"""


def _strip_trailing_commas(s: str) -> str:
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


def _extract_json_array(raw: str) -> list:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if "```" in raw:
            raw = raw.rsplit("```", 1)[0]
        raw = raw.strip()
    idx = raw.find("[")
    if idx == -1:
        raise ValueError("No JSON array found")
    raw = raw[idx:]
    ridx = raw.rfind("]")
    if ridx == -1:
        raise ValueError("No closing ] found")
    return json.loads(_strip_trailing_commas(raw[:ridx + 1]))


def _run_llm_critic(
    resume: dict,
    original_resume: dict,
    entity_manifest: dict,
    voice_anchor: str,
    required_keywords: list[str],
    llm,
) -> dict:
    bullets = _collect_bullets(resume)
    original_bullets = _collect_bullets(original_resume)
    allowed_entities = entity_manifest.get("all_entities", [])[:30]

    dynamic = (
        f"Required keywords (check if surfaced): {', '.join(required_keywords)}\n"
        f"Allowed entities: {', '.join(str(e) for e in allowed_entities)}\n\n"
        f"Voice samples (reference for tone):\n{voice_anchor}\n\n"
        f"Original bullets:\n{json.dumps(original_bullets, indent=2)}\n\n"
        f"Rewritten bullets:\n{json.dumps(bullets, indent=2)}\n\n"
        f"Summary:\n{resume.get('summary', '')}\n\n"
        "Identify all violations across all three passes. Return JSON."
    )

    try:
        raw = llm.complete(_CRITIC_SYSTEM, dynamic, max_tokens=4096)
        return _extract_json(raw)
    except Exception as e:
        log.warning("[critic] LLM critic call failed (%s) — treating as pass", e)
        return {"violations": [], "missing_keywords": [], "overall_pass": True}


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
        if bid and bid != "summary" and re.match(r"exp\d+\.b\d+", bid):
            by_bullet.setdefault(bid, []).append(v)

    if not by_bullet:
        return result

    allowed_entities = entity_manifest.get("all_entities", [])[:30]
    entity_str = ", ".join(str(e) for e in allowed_entities)

    # Build revision request
    items = []
    for bid, vios in by_bullet.items():
        m = re.match(r"exp(\d+)\.b(\d+)", bid)
        if not m:
            continue
        i, j = int(m.group(1)), int(m.group(2))
        exp_list = result.get("experience", [])
        if i >= len(exp_list):
            continue
        bullets = exp_list[i].get("bullets", [])
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
        raw = llm.complete(_REVISE_SYSTEM, dynamic, max_tokens=2048)
        fixed_items = _extract_json_array(raw)
        id_to_text = {
            item["id"]: item["text"]
            for item in fixed_items
            if "id" in item and "text" in item
        }

        for bid, text in id_to_text.items():
            m = re.match(r"exp(\d+)\.b(\d+)", bid)
            if not m:
                continue
            i, j = int(m.group(1)), int(m.group(2))
            exp_list = result.get("experience", [])
            if i < len(exp_list):
                exp_bullets = exp_list[i].get("bullets", [])
                if j < len(exp_bullets):
                    result["experience"][i]["bullets"][j] = text

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
        llm_violations = llm_result.get("violations", [])
        all_violations.extend(llm_violations)

        combined = det_result["violations"] + llm_violations
        if not combined:
            break

        current = _revise_violations(current, combined, entity_manifest, voice_anchor, llm)

    log.info("[critic] done: %d total violation(s) across all iterations", len(all_violations))
    return current, all_violations
