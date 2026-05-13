"""
Planner Gap 1a — Entity Manifest Extraction.
Numbers from resume + JD; optional spaCy ORG/PRODUCT/GPE on combined text.
"""
import re
import logging

log = logging.getLogger("resume")

NUMERIC = re.compile(r"\d+(?:\.\d+)?\s*(?:%|x|X|k|K|M|B|ms|s|QPS|qps)", re.IGNORECASE)


def extract_entity_manifest(resume_text, jd_text):
    """
    Build a whitelist of strings that may appear in tailored output without
    being flagged as fabricated. Includes metrics and (when spaCy is available)
    named entities from resume + JD text.
    """
    combined = f"{resume_text or ''} {jd_text or ''}"
    entities: list[str] = []

    for m in NUMERIC.finditer(combined):
        token = m.group(0).strip()
        if token:
            entities.append(token)

    try:
        import spacy
        nlp = spacy.load("en_core_web_sm")
        doc = nlp(combined[: min(len(combined), 500_000)])
        for ent in doc.ents:
            if ent.label_ in ("ORG", "PRODUCT", "GPE", "PERSON", "EVENT", "WORK_OF_ART", "FAC"):
                t = ent.text.strip()
                if len(t) > 1:
                    entities.append(t)
    except Exception as e:
        log.debug("[entity_manifest] spaCy enrichment skipped: %s", e)

    seen: set[str] = set()
    out: list[str] = []
    for e in entities:
        k = e.lower()
        if k not in seen:
            seen.add(k)
            out.append(e)

    log.info("[entity_manifest] %d whitelist entries (metrics + entities)", len(out))
    return {"all_entities": out}
