"""
presets.py
Role × Level → suggested template + section order lookup table.
"""

PRESETS: dict[tuple[str, str], dict] = {
    # ── Software Engineering ──────────────────────────────────────────────────
    ("SDE", "entry"):  {"template": "jake",      "sections": ["education", "skills", "projects", "experience"]},
    ("SDE", "junior"): {"template": "jake",      "sections": ["skills", "experience", "projects", "education"]},
    ("SDE", "mid"):    {"template": "jake",      "sections": ["summary", "experience", "skills", "education"]},

    # ── Data Engineering ──────────────────────────────────────────────────────
    ("DE", "entry"):   {"template": "sb2nov",    "sections": ["education", "skills", "projects", "experience"]},
    ("DE", "junior"):  {"template": "sb2nov",    "sections": ["skills", "experience", "projects", "education"]},
    ("DE", "mid"):     {"template": "sb2nov",    "sections": ["summary", "experience", "skills", "education"]},

    # ── ML / Data Science ─────────────────────────────────────────────────────
    ("ML Engineer", "entry"):  {"template": "sb2nov", "sections": ["education", "skills", "projects", "experience", "publications"]},
    ("ML Engineer", "junior"): {"template": "sb2nov", "sections": ["skills", "experience", "projects", "education"]},
    ("ML Engineer", "mid"):    {"template": "sb2nov", "sections": ["summary", "experience", "skills", "projects", "publications"]},

    ("Data Scientist", "entry"):  {"template": "sb2nov", "sections": ["education", "skills", "projects", "experience", "publications"]},
    ("Data Scientist", "junior"): {"template": "sb2nov", "sections": ["skills", "experience", "projects", "education"]},
    ("Data Scientist", "mid"):    {"template": "sb2nov", "sections": ["summary", "experience", "skills", "projects", "education"]},

    ("Data Analyst", "entry"):  {"template": "sb2nov",    "sections": ["education", "skills", "projects", "experience"]},
    ("Data Analyst", "junior"): {"template": "myresume",  "sections": ["skills", "experience", "projects", "education"]},
    ("Data Analyst", "mid"):    {"template": "myresume",  "sections": ["summary", "experience", "skills", "education"]},

    # ── Product / Business ────────────────────────────────────────────────────
    ("PM", "entry"):  {"template": "faangpath", "sections": ["summary", "experience", "skills", "education", "certifications"]},
    ("PM", "junior"): {"template": "faangpath", "sections": ["summary", "experience", "skills", "education", "certifications"]},
    ("PM", "mid"):    {"template": "faangpath", "sections": ["summary", "experience", "skills", "certifications", "education"]},

    ("BA", "entry"):  {"template": "faangpath", "sections": ["summary", "experience", "skills", "education", "certifications"]},
    ("BA", "junior"): {"template": "faangpath", "sections": ["summary", "experience", "skills", "education", "certifications"]},
    ("BA", "mid"):    {"template": "faangpath", "sections": ["summary", "experience", "skills", "certifications", "education"]},

    ("TPM", "entry"):  {"template": "faangpath", "sections": ["summary", "experience", "skills", "education", "certifications"]},
    ("TPM", "junior"): {"template": "faangpath", "sections": ["summary", "experience", "skills", "education", "certifications"]},
    ("TPM", "mid"):    {"template": "faangpath", "sections": ["summary", "experience", "skills", "certifications", "education"]},

    # ── DevOps / Infrastructure ───────────────────────────────────────────────
    ("DevOps", "entry"):  {"template": "jake", "sections": ["skills", "education", "projects", "experience"]},
    ("DevOps", "junior"): {"template": "jake", "sections": ["skills", "experience", "projects", "education"]},
    ("DevOps", "mid"):    {"template": "jake", "sections": ["summary", "experience", "skills", "certifications", "education"]},
}

# Fallback by level when role isn't in the table
_DEFAULTS: dict[str, dict] = {
    "entry":  {"template": "jake", "sections": ["education", "skills", "projects", "experience"]},
    "junior": {"template": "jake", "sections": ["skills", "experience", "projects", "education"]},
    "mid":    {"template": "jake", "sections": ["summary", "experience", "skills", "education"]},
}


def get_preset(role: str, level: str) -> dict:
    """
    Return {"template": str, "sections": [str, ...]} for the given role + level.
    Falls back to level-based defaults if the combination isn't in the table.
    """
    preset = PRESETS.get((role, level)) or _DEFAULTS.get(level) or _DEFAULTS["entry"]
    return {"template": preset["template"], "sections": list(preset["sections"])}
