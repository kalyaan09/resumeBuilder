"""
Controller — Gap 4.
Orchestrates Planner → Navigator → Critic.
Reads history.json violation patterns for prompt health insights.
Writes pipeline violations to a separate file for /prompt-health consumption.
"""
import json
import logging
from pathlib import Path

from .entity_manifest import extract_entity_manifest
from .planner import run_planner, EditPlan
from .navigator import run_navigator, build_voice_anchor
from .critic import run_critic
from .single_shot import apply_single_shot_over_navigator, run_aggressive_single_shot

log = logging.getLogger("resume")

_DATA_DIR = Path.home() / ".resume-editor"
HISTORY_PATH = _DATA_DIR / "history.json"
VIOLATIONS_PATH = _DATA_DIR / "pipeline_violations.json"


def analyze_critic_patterns(history_path: Path = VIOLATIONS_PATH) -> dict:
    """
    Read pipeline_violations.json and surface the top 3 recurring violation rules.
    Used by GET /prompt-health to give visibility into which rules keep failing.
    """
    if not history_path.exists():
        return {"top_recurring_violations": [], "total_runs": 0}

    try:
        with open(history_path) as f:
            data = json.load(f)
    except Exception as e:
        log.warning("[controller] violations file read failed: %s", e)
        return {"top_recurring_violations": [], "total_runs": 0}

    runs = data.get("runs", [])
    violation_counts: dict[str, int] = {}
    for run in runs:
        for v in run.get("violations", []):
            rule = v.get("rule", "UNKNOWN")
            violation_counts[rule] = violation_counts.get(rule, 0) + 1

    top = sorted(violation_counts.items(), key=lambda x: x[1], reverse=True)[:3]
    return {
        "top_recurring_violations": [{"rule": r, "count": c} for r, c in top],
        "total_runs": len(runs),
    }


def _polish_rewrite_count(plan: EditPlan) -> int:
    return sum(1 for bp in plan.bullet_plans if bp.action in ("polish", "rewrite"))


def _bullet_unchanged_ratio(original: dict, candidate: dict) -> float:
    """Fraction of paired experience bullets that are identical (whitespace-normalized)."""
    total = 0
    same = 0
    oex = original.get("experience", [])
    cex = candidate.get("experience", [])
    for ei in range(min(len(oex), len(cex))):
        ob = oex[ei].get("bullets", []) if isinstance(oex[ei], dict) else []
        cb = cex[ei].get("bullets", []) if isinstance(cex[ei], dict) else []
        for j in range(min(len(ob), len(cb))):
            total += 1
            if str(ob[j]).strip() == str(cb[j]).strip():
                same += 1
    if total == 0:
        return 0.0
    return same / total


def _store_pipeline_violations(violations: list[dict], profile_id: str, role: str) -> None:
    """Append a pipeline run's violations to pipeline_violations.json (non-critical)."""
    try:
        _DATA_DIR.mkdir(parents=True, exist_ok=True)

        if VIOLATIONS_PATH.exists():
            with open(VIOLATIONS_PATH) as f:
                data = json.load(f)
        else:
            data = {"runs": []}

        from datetime import datetime
        data["runs"].append({
            "date": datetime.now().isoformat()[:10],
            "profile_id": profile_id,
            "role": role,
            "violations": violations,
            "violation_count": len(violations),
        })

        with open(VIOLATIONS_PATH, "w") as f:
            json.dump(data, f, indent=2)

    except Exception as e:
        log.warning("[controller] storing violations failed (non-critical): %s", e)


def run_pipeline(
    profile_resume: dict,
    basics: dict,
    jd_text: str,
    transformers_context: dict,
    user_instructions: str,
    llm_config: dict,
    config: dict,
    candidate_persona: str,
    skill_allowlist: list[str],
) -> tuple[dict, list[dict]]:
    """
    Orchestrate the 4-agent pipeline:
      1. Entity Manifest (deterministic)
      2. Planner (LLM) — per-bullet edit plan
      3. Navigator (LLM) — route-specific rewrites + summary last
      4. Critic (deterministic + optional LLM) — validate and fix

    Returns (tailored_resume, all_violations_found).
    Raises on unrecoverable error so the caller can fall back gracefully.
    """
    from llm_client import LLMClient
    llm = LLMClient.from_config(llm_config)

    required_keywords: list[str] = transformers_context.get("must_include_keywords", [])
    profile_id: str = profile_resume.get("id", "")
    role: str = transformers_context.get("detected_role", "") or profile_resume.get("name", "")

    # ── Step 1: Entity manifest ──────────────────────────────────────────────
    log.info("[pipeline] step 1/4 — entity manifest")
    resume_parts = []
    for exp in profile_resume.get("experience", []):
        resume_parts.append(exp.get("title", ""))
        resume_parts.append(exp.get("company", ""))
        resume_parts.extend(exp.get("bullets", []))
    for proj in profile_resume.get("projects", []):
        resume_parts.extend(proj.get("bullets", []))
    resume_parts.append(profile_resume.get("summary", ""))
    resume_text = " ".join(p for p in resume_parts if p)
    entity_manifest = extract_entity_manifest(resume_text, jd_text)
    log.info("[pipeline] entity manifest: %d entities extracted",
             len(entity_manifest["all_entities"]))

    # ── Step 2: Planner ──────────────────────────────────────────────────────
    log.info("[pipeline] step 2/4 — planner")
    plan = run_planner(
        profile_resume=profile_resume,
        basics=basics,
        jd_text=jd_text,
        transformers_context=transformers_context,
        candidate_persona=candidate_persona,
        required_keywords=required_keywords,
        llm=llm,
    )
    actions = [bp.action for bp in plan.bullet_plans]
    log.info(
        "[pipeline] planner done: %d bullets — keep=%d polish=%d rewrite=%d drop=%d",
        len(actions),
        actions.count("keep"),
        actions.count("polish"),
        actions.count("rewrite"),
        actions.count("drop"),
    )
    if plan.bullet_plans and all(bp.action == "keep" for bp in plan.bullet_plans):
        log.warning(
            "[pipeline] planner chose KEEP for every bullet — experience text will not change; "
            "only the summary will be rewritten. Try a richer JD or a different model if that is unexpected."
        )

    # ── Step 3: Navigator ────────────────────────────────────────────────────
    log.info("[pipeline] step 3/4 — navigator")
    navigated = run_navigator(
        profile_resume=profile_resume,
        plan=plan,
        entity_manifest=entity_manifest,
        candidate_persona=candidate_persona,
        jd_text=jd_text,
        llm=llm,
    )
    log.info("[pipeline] navigation complete: exp_blocks=%d, proj_blocks=%d",
             len(navigated.get("experience", [])), len(navigated.get("projects", [])))

    touch = _polish_rewrite_count(plan)
    unchanged = _bullet_unchanged_ratio(profile_resume, navigated)
    if touch >= 2 and unchanged >= 0.70:
        log.warning(
            "[pipeline] navigator left %.0f%% of bullets unchanged but planner slated %d for polish/rewrite — "
            "running single-shot visible tailor",
            unchanged * 100,
            touch,
        )
        try:
            shot = run_aggressive_single_shot(
                llm,
                profile_resume,
                jd_text,
                candidate_persona,
                user_instructions,
                transformers_context,
            )
            navigated = apply_single_shot_over_navigator(navigated, shot)
            log.info(
                "[pipeline] single-shot pass applied — bullet unchanged ratio now %.0f%%",
                _bullet_unchanged_ratio(profile_resume, navigated) * 100,
            )
        except Exception as e:
            log.warning("[pipeline] single-shot tailor failed (%s) — keeping navigator output", e)

    log.info(
        "[pipeline] navigator done — keys=%s experience_blocks=%d summary_len=%d",
        list(navigated.keys()),
        len(navigated.get("experience", [])),
        len(str(navigated.get("summary", ""))),
    )
    log.debug("[pipeline] navigator snippet: %s", json.dumps(navigated)[:500])

    # ── Step 4: Critic ───────────────────────────────────────────────────────
    log.info("[pipeline] step 4/4 — critic")
    voice_anchor = build_voice_anchor(profile_resume, plan.bullet_plans)
    validated, violations = run_critic(
        resume=navigated,
        original_resume=profile_resume,
        entity_manifest=entity_manifest,
        voice_anchor=voice_anchor,
        required_keywords=required_keywords,
        llm=llm,
    )

    log.info(
        "[pipeline] critic done — passed=%s violations=%d final_keys=%s experience_blocks=%d",
        len(violations) == 0,
        len(violations),
        list(validated.keys()),
        len(validated.get("experience", [])),
    )
    log.debug("[pipeline] critic snippet: %s", json.dumps(validated)[:500])
    log.info("[pipeline] complete — %d total violation(s) found/fixed", len(violations))

    # Field-by-field inspection of what's going back to main.py
    log.info("[pipeline] final resume field audit:")
    for key, val in validated.items():
        if key == "experience":
            log.info("  experience: %d blocks", len(val))
            for i, exp in enumerate(val):
                log.info("    exp%d: %s | %s | bullets=%d",
                         i, exp.get("company", "?"), exp.get("title", "?"),
                         len(exp.get("bullets", [])))
        elif key == "summary":
            log.info("  summary: %d chars — %s…", len(str(val)), str(val)[:120])
        elif key == "skills":
            log.info("  skills: %d categories", len(val) if isinstance(val, list) else 1)
        else:
            log.info("  %s: %s", key, str(val)[:80])

    # Store violations for /prompt-health (non-blocking)
    _store_pipeline_violations(violations, profile_id, role)

    return validated, violations
