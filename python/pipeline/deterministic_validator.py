"""
Critic Gap 3a — Deterministic Validator.
Runs before any LLM critic call. Sub-second, free, always-on.
Extends the original validate_output() with banned words, weak openers,
em dashes, unsafe verb upgrades, and entity fabrication detection.
"""
import re
import logging

log = logging.getLogger("resume")

BANNED_PATTERNS = [
    r"\bleverag\w*", r"\bdelv\w+", r"\brobust\b", r"\bseamless\w*",
    r"\butili[sz]\w*", r"\bharness\w*", r"\bfoster\w*", r"\bstreamlin\w*",
    r"\bpivotal\b", r"\bspearhead\w*", r"\bunderscore\w*",
    r"\bsynerg\w*", r"\btransformative\b", r"\bmeticulous\w*",
    r"\bgarner\w*", r"\bembark\w*", r"\bcutting[- ]edge\b",
]

WEAK_OPENERS = re.compile(
    r"^(Responsible for|Helped|Worked on|Assisted|Tasked with|"
    r"Participated in|Involved in)\b",
    re.IGNORECASE,
)

UNSAFE_VERB_UPGRADES = {
    "designed", "architected", "pioneered", "founded",
    "spearheaded", "established",
}


def _structured_whitelist(original_resume: dict) -> set[str]:
    """Company names, titles, project names, summary — always safe in tailored output."""
    s: set[str] = set()

    def add_str(x: object) -> None:
        if not x or not isinstance(x, str):
            return
        t = x.strip()
        if len(t) < 2:
            return
        s.add(t)
        for part in re.split(r"[/|,;]+", t):
            p = part.strip()
            if len(p) > 1:
                s.add(p)

    add_str(original_resume.get("summary"))
    for exp in original_resume.get("experience", []):
        add_str(exp.get("company"))
        add_str(exp.get("title"))
    for proj in original_resume.get("projects", []):
        add_str(proj.get("name"))
    return s


def _entity_allowed(ent_text: str, allowed: set[str]) -> bool:
    """True if spaCy entity text matches or overlaps any whitelist string (substring)."""
    e = ent_text.strip()
    if not e:
        return True
    if e in allowed:
        return True
    el = e.lower()
    for a in allowed:
        if not a or not isinstance(a, str):
            continue
        al = a.lower().strip()
        if len(al) < 2:
            continue
        if al in el or el in al:
            return True
    return False


def _collect_bullets(resume: dict) -> list[dict]:
    """Return all experience bullets as [{"id": "exp0.b0", "text": "..."}]."""
    bullets = []
    for i, exp in enumerate(resume.get("experience", [])):
        for j, text in enumerate(exp.get("bullets", [])):
            bullets.append({"id": f"exp{i}.b{j}", "text": text})
    return bullets


def run_deterministic_checks(
    resume: dict,
    original_resume: dict,
    entity_manifest: dict,
) -> dict:
    """
    Run all deterministic checks on the rewritten resume.
    Returns {"violations": [...], "fabricated_entities": [...], "passed": bool}.
    """
    rewritten_bullets = _collect_bullets(resume)
    summary = resume.get("summary", "")
    violations = []

    log.info("[det_validator] scanning %d bullets + summary (%d chars)",
             len(rewritten_bullets), len(summary))
    full_scan_text = " | ".join(b["text"] for b in rewritten_bullets) + " | SUMMARY: " + summary
    log.debug("[det_validator] full scan text: %s", full_scan_text[:1000])

    # 1. Banned word scan per bullet AND summary
    for bullet in rewritten_bullets:
        for pattern in BANNED_PATTERNS:
            m = re.search(pattern, bullet["text"], re.IGNORECASE)
            if m:
                violations.append({
                    "rule": "BANNED_WORD",
                    "bullet_id": bullet["id"],
                    "span": m.group(),
                    "fix": f"Replace '{m.group()}' with a plain, direct alternative",
                })
    for pattern in BANNED_PATTERNS:
        m = re.search(pattern, summary, re.IGNORECASE)
        if m:
            violations.append({
                "rule": "BANNED_WORD",
                "bullet_id": "summary",
                "span": m.group(),
                "fix": f"Replace '{m.group()}' in summary with a plain, direct alternative",
            })

    # 2. Weak opener scan
    for bullet in rewritten_bullets:
        if WEAK_OPENERS.match(bullet["text"]):
            violations.append({
                "rule": "WEAK_OPENER",
                "bullet_id": bullet["id"],
                "span": bullet["text"][:50],
                "fix": "Start with a strong past-tense action verb",
            })

    # 3. Em dash scan (bullets and summary)
    for bullet in rewritten_bullets:
        if "—" in bullet["text"]:
            violations.append({
                "rule": "EM_DASH",
                "bullet_id": bullet["id"],
                "span": "—",
                "fix": "Replace em dash with a comma or semicolon",
            })
    if "—" in summary:
        violations.append({
            "rule": "EM_DASH",
            "bullet_id": "summary",
            "span": "—",
            "fix": "Remove em dash from summary",
        })

    # 4. Unsafe verb upgrade check (seed from original validate_output logic)
    orig_exps = original_resume.get("experience", [])
    for i, exp in enumerate(resume.get("experience", [])):
        if i >= len(orig_exps):
            break
        orig_exp = orig_exps[i]
        orig_bullets = orig_exp.get("bullets", [])
        for j, bullet_text in enumerate(exp.get("bullets", [])):
            if j >= len(orig_bullets):
                break
            first_word = (
                bullet_text.strip().split()[0].lower().rstrip(".,")
                if bullet_text.strip() else ""
            )
            orig_first = (
                orig_bullets[j].strip().split()[0].lower().rstrip(".,")
                if orig_bullets[j].strip() else ""
            )
            if first_word in UNSAFE_VERB_UPGRADES and orig_first not in UNSAFE_VERB_UPGRADES:
                violations.append({
                    "rule": "UNSAFE_VERB",
                    "bullet_id": f"exp{i}.b{j}",
                    "span": first_word,
                    "fix": (
                        f"Replace '{first_word}' with a safer verb; "
                        f"original started with '{orig_first}'"
                    ),
                })

    # 5. Entity fabrication check — only runs if spaCy is available
    fabricated: list[str] = []
    allowed: set[str] = {str(x) for x in entity_manifest.get("all_entities", []) if x}
    allowed |= _structured_whitelist(original_resume)

    if allowed:
        try:
            import spacy
            nlp = spacy.load("en_core_web_sm")
            all_output_text = " ".join(b["text"] for b in rewritten_bullets) + " " + summary
            output_doc = nlp(all_output_text)
            output_entities = {
                ent.text.strip()
                for ent in output_doc.ents
                if ent.label_ in ("ORG", "PRODUCT", "GPE")
            }
            fabricated = [e for e in output_entities if not _entity_allowed(e, allowed)]
            log.info(
                "[det_validator] entity check — whitelist=%d output_entities=%d fabricated=%d",
                len(allowed), len(output_entities), len(fabricated),
            )
            log.debug("[det_validator] output entities: %s", sorted(output_entities))
            if fabricated:
                log.info("[det_validator] fabricated entities (novel vs resume/JD): %s", fabricated)
                violations.append({
                    "rule": "FABRICATED_ENTITY",
                    "bullet_id": None,
                    "span": str(fabricated),
                    "fix": "Remove entities not present in original resume or JD",
                })
        except Exception as ex:
            log.warning("[det_validator] entity check skipped: %s", ex)

    log.info(
        "[deterministic_validator] %d violation(s), fabricated=%s, passed=%s",
        len(violations),
        fabricated,
        len(violations) == 0,
    )

    return {
        "violations": violations,
        "fabricated_entities": fabricated,
        "passed": len(violations) == 0,
    }
