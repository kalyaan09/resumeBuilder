# LLM Redesign — Resume Pro

## Overview
Redesign the entire LLM pipeline in the Python sidecar. This is the most important update to the app. Read everything carefully before writing any code.

---

## 1. Update llm_client.py — Split Static/Dynamic + Caching

### New `complete()` signature
Change from one prompt to two:
```python
# Old
def complete(self, system_prompt: str, user_prompt: str, max_tokens: int = 4096) -> str

# New
def complete(self, static_prompt: str, dynamic_prompt: str, max_tokens: int = 4096) -> str
```

`static_prompt` = never changes between calls (gets cached)
`dynamic_prompt` = changes every call (never cached)

### Add GeminiCacheManager class
```python
class GeminiCacheManager:
    def __init__(self):
        self._cache_name = None
        self._cache_created_at = None
        self._cache_ttl = 3600  # 1 hour

    def get_or_create_cache(self, static_prompt: str, model: str, api_key: str) -> str:
        import time
        if (self._cache_name and self._cache_created_at and
                time.time() - self._cache_created_at < self._cache_ttl - 60):
            return self._cache_name
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        cache = genai.caching.CachedContent.create(
            model=model,
            system_instruction=static_prompt,
            ttl=f"{self._cache_ttl}s"
        )
        self._cache_name = cache.name
        self._cache_created_at = time.time()
        return self._cache_name
```

### Provider implementations

**Anthropic — explicit cache_control:**
```python
def _complete_anthropic(self, static_prompt, dynamic_prompt, max_tokens):
    client = anthropic.Anthropic(api_key=self.api_key)
    response = client.messages.create(
        model=self.model,
        max_tokens=max_tokens,
        system=[
            {
                "type": "text",
                "text": static_prompt,
                "cache_control": {"type": "ephemeral"}
            }
        ],
        messages=[{"role": "user", "content": dynamic_prompt}]
    )
    return response.content[0].text
```

**OpenAI / Groq / OpenRouter — automatic caching (same code, different base_url):**
```python
def _complete_openai(self, static_prompt, dynamic_prompt, max_tokens):
    client = OpenAI(api_key=self.api_key, base_url=self.base_url)
    response = client.chat.completions.create(
        model=self.model,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": static_prompt},
            {"role": "user", "content": dynamic_prompt}
        ]
    )
    return response.choices[0].message.content
```

**Gemini — explicit cache via GeminiCacheManager:**
```python
def _complete_gemini(self, static_prompt, dynamic_prompt, max_tokens):
    cache_name = self.cache_manager.get_or_create_cache(
        static_prompt, self.model, self.api_key
    )
    import google.generativeai as genai
    model = genai.GenerativeModel.from_cached_content(cached_content=cache_name)
    response = model.generate_content(dynamic_prompt)
    return response.text
```

**Ollama — local, no caching needed:**
```python
def _complete_ollama(self, static_prompt, dynamic_prompt, max_tokens):
    response = requests.post(
        f"{self.base_url}/api/chat",
        json={
            "model": self.model,
            "messages": [
                {"role": "system", "content": static_prompt},
                {"role": "user", "content": dynamic_prompt}
            ],
            "stream": False
        }
    )
    return response.json()["message"]["content"]
```

**Route in complete():**
```python
def complete(self, static_prompt: str, dynamic_prompt: str, max_tokens: int = 4096) -> str:
    if self.provider == "anthropic":
        return self._complete_anthropic(static_prompt, dynamic_prompt, max_tokens)
    elif self.provider in ("openai", "groq", "openrouter"):
        return self._complete_openai(static_prompt, dynamic_prompt, max_tokens)
    elif self.provider == "gemini":
        return self._complete_gemini(static_prompt, dynamic_prompt, max_tokens)
    elif self.provider == "ollama":
        return self._complete_ollama(static_prompt, dynamic_prompt, max_tokens)
```

---

## 2. Update main.py — /edit-resume endpoint

### Remove
- `research_text` field — completely removed from request model and prompt
- All references to "master resume" — rename to "profile resume"

### Add to EditResumeRequest
```python
class EditResumeRequest(BaseModel):
    jd_text: str
    profile_resume: dict       # renamed from master_resume
    profile_name: str          # e.g. "Backend Engineer"
    basics: dict               # shared basics (name, email etc)
    shared_education: list     # shared education
    user_instructions: str = ""
    llm_config: dict
    transformers_context: dict = {}  # from Transformers.js
```

### Build skill allowlist
```python
def build_skill_allowlist(profile: dict) -> list[str]:
    return [
        item
        for skill_group in profile.get("skills", [])
        for item in skill_group.get("items", [])
    ]
```

### Build candidate persona dynamically
```python
def build_candidate_persona(basics: dict, profile: dict, config: dict, skill_allowlist: list[str]) -> str:
    top_skills = skill_allowlist[:12]
    companies = [exp.get("company", "") for exp in profile.get("experience", [])]
    education = basics.get("education", [{}])
    edu = education[0] if education else {}
    name = basics.get("basics", {}).get("name", "")
    profile_name = profile.get("name", "")
    level = config.get("level", "")

    return f"""CANDIDATE PROFILE:
- Name: {name}
- Targeting: {profile_name} roles
- Experience level: {level}
- Education: {edu.get('degree', '')} from {edu.get('institution', '')}
- Allowed skills (strict list): {', '.join(top_skills)}
- Experience at: {', '.join(companies)}
- Domain: {profile_name} — this domain must be preserved in the output. Never transform this into a different role domain."""
```

### Static system prompt (cached part)
```python
_STATIC_SYSTEM_PROMPT = """You are a resume tailoring assistant. Your job is to emphasize and reframe the candidate's existing experience to match the job description. You are NOT a resume rewriter.

DOMAIN RULES:

1. DOMAIN PROTECTION
Never change the candidate's core domain. If the candidate is a Backend Engineer, the output must remain a Backend Engineer resume. If the JD requires skills the candidate does not have, ignore those requirements entirely. Never add any skill, framework, or tool unless it already exists in the candidate's allowed skills list.

2. SKILLS INTEGRITY
Only use skills from the candidate's allowed skills list provided in the user message. Never add anything outside it. If a JD keyword has no match in the allowed skills list, skip it silently.

3. EXPERIENCE BOUNDARY
Never upgrade the candidate's role or responsibilities beyond what is stated in their profile.
Safe verb substitutions: maintained, improved, optimized, streamlined, reduced, increased, automated, delivered
Unsafe verb upgrades — never use these unless already in original: designed, architected, pioneered, founded, spearheaded, established, owned, led
The verb choice must reflect the candidate's actual level of ownership.

4. KEYWORD MATCHING ONLY
Surface existing experience that matches JD keywords. If there is no match, skip it silently. Never fabricate a match with vague language.

5. SUMMARY SCOPE
You may rewrite the professional summary to mirror JD language. Every claim in the summary must be backed by at least one bullet in the experience section. No orphaned claims.

6. REORDERING ALLOWED
You may reorder bullet points within a role to prioritize JD-relevant ones. You may reorder skills rows to move relevant skills forward. You may NOT add new bullets or skills not in the profile.

7. IGNORE LIST
For every JD requirement with no match in the candidate profile, skip it silently. Do not mention gaps. Do not attempt to bridge gaps with vague language.

WRITING RULES:

8. GOOGLE XYZ FORMAT
Every bullet: Accomplished [X] as measured by [Y] by doing [Z]. Lead with the result or action, include a quantified metric where one exists in the original, end with the method. If no metric exists, lead with a strong action verb and end with impact.

9. HARVARD ACTION VERBS
Every bullet must start with a strong past-tense action verb.
Approved: Built, Designed, Engineered, Developed, Implemented, Architected, Reduced, Improved, Increased, Cut, Drove, Owned, Led, Diagnosed, Investigated, Validated, Benchmarked, Conducted, Partnered, Mentored, Deployed, Migrated, Automated, Optimized, Delivered, Launched.
Never start with: Responsible for, Worked on, Helped with, Was involved in, Supported, Assisted.

10. ACTIVE VOICE ONLY
Never use passive voice.
Wrong: Systems were monitored by the candidate
Right: Monitored systems across globally deployed infrastructure

11. TWO LINE MAXIMUM
No bullet point may exceed two lines when rendered at 10.5pt font. If a bullet exceeds two lines, split it or cut the least impactful clause.

12. NO EM DASHES
Never use em dashes. Use commas or semicolons instead. Em dashes are a known AI writing signal.

13. NO AI PHRASES
Never use: leverage, optimize, unleash, game-changing, revolutionary, transformative, dive into, unlock potential. Write like a human engineer talking to another engineer.

14. CONSISTENCY CHECK
Before returning output, verify:
- Every summary claim has a supporting bullet in experience
- No skill appears in output that is absent from the allowed skills list
- No bullet exceeds two lines
- No bullet starts with a prohibited phrase
- No em dash appears anywhere in the output
Fix any failure before returning.

OUTPUT FORMAT:
Return only the tailored resume JSON. Exact same structure and keys as input. Same number of items in every array. No explanations. No commentary. No code fences. Valid JSON only."""
```

### Dynamic prompt builder
```python
def build_dynamic_prompt(
    profile_resume: dict,
    basics: dict,
    jd_text: str,
    candidate_persona: str,
    user_instructions: str,
    transformers_context: dict
) -> str:
    # Build context block from Transformers.js analysis
    ctx = ""
    if transformers_context:
        detected_role = transformers_context.get("detected_role", "")
        keywords = transformers_context.get("must_include_keywords", [])
        seniority = transformers_context.get("seniority", "")
        company_type = transformers_context.get("company_type", "")
        weak_indices = transformers_context.get("weak_bullet_indices", [])

        ctx_parts = []
        if detected_role:
            ctx_parts.append(f"Role detected: {detected_role}")
        if keywords:
            ctx_parts.append(f"Keywords to surface naturally if present in profile: {', '.join(keywords)}")
        if seniority:
            ctx_parts.append(f"Seniority: {seniority}")
        if company_type:
            ctx_parts.append(f"Company type: {company_type}")
        if weak_indices:
            ctx_parts.append(f"Focus extra rewriting effort on bullets at indices: {', '.join(map(str, weak_indices))} — these matched JD poorly")
        if ctx_parts:
            ctx = "\n\nJD ANALYSIS (from local analysis):\n" + "\n".join(ctx_parts)

    user_instr = f"\n\nUser preferences:\n{user_instructions}" if user_instructions.strip() else ""

    return f"""{candidate_persona}{ctx}{user_instr}

Job Description Keywords:
{jd_text}

Profile Resume (JSON):
{json.dumps(profile_resume, indent=2)}

Return the tailored profile resume as valid JSON with the exact same structure."""
```

### Post-generation validation
```python
UNSAFE_VERB_UPGRADES = {
    'designed', 'architected', 'pioneered', 'founded',
    'spearheaded', 'established'
}

def validate_output(original: dict, generated: dict, skill_allowlist: list[str]) -> dict:
    # 1. Revert skills not in allowlist
    allowlist_lower = [s.lower() for s in skill_allowlist]
    for skill_group in generated.get("skills", []):
        skill_group["items"] = [
            item for item in skill_group.get("items", [])
            if any(
                orig in item.lower() or item.lower() in orig
                for orig in allowlist_lower
            )
        ]

    # 2. Revert unsafe verb upgrades
    for i, exp in enumerate(generated.get("experience", [])):
        orig_exp = original.get("experience", [{}] * (i + 1))
        if i >= len(orig_exp):
            break
        for j, bullet in enumerate(exp.get("bullets", [])):
            orig_bullets = orig_exp[i].get("bullets", [])
            if j >= len(orig_bullets):
                break
            first_word = bullet.strip().split()[0].lower().rstrip(".,") if bullet.strip() else ""
            orig_first = orig_bullets[j].strip().split()[0].lower().rstrip(".,") if orig_bullets[j].strip() else ""
            if first_word in UNSAFE_VERB_UPGRADES and orig_first not in UNSAFE_VERB_UPGRADES:
                generated["experience"][i]["bullets"][j] = orig_bullets[j]

    return generated
```

### Updated /edit-resume handler
```python
@app.post("/edit-resume")
async def edit_resume(req: EditResumeRequest):
    llm = LLMClient(
        provider=req.llm_config["provider"],
        model=req.llm_config["model"],
        api_key=req.llm_config.get("api_key"),
        base_url=req.llm_config.get("base_url")
    )

    config = _load_config()
    skill_allowlist = build_skill_allowlist(req.profile_resume)
    candidate_persona = build_candidate_persona(
        req.basics, req.profile_resume, config, skill_allowlist
    )

    dynamic_prompt = build_dynamic_prompt(
        profile_resume=req.profile_resume,
        basics=req.basics,
        jd_text=req.jd_text,
        candidate_persona=candidate_persona,
        user_instructions=req.user_instructions,
        transformers_context=req.transformers_context
    )

    raw = llm.complete(
        static_prompt=_STATIC_SYSTEM_PROMPT,
        dynamic_prompt=dynamic_prompt,
        max_tokens=8192
    )

    # Strip code fences if present
    clean = raw.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```[a-z]*\n?", "", clean)
        clean = re.sub(r"\n?```$", "", clean)

    edited = json.loads(clean)
    validated = validate_output(req.profile_resume, edited, skill_allowlist)

    return {"resume": validated}
```

---

## 3. Silent History Storage — after every export

In the `/export-pdf` endpoint, after successful PDF generation, append to `~/.resume-editor/history.json`:

```python
def _append_history(profile_id: str, transformers_context: dict, font_size: float, pages: int):
    history_path = Path.home() / ".resume-editor" / "history.json"
    try:
        if history_path.exists():
            with open(history_path) as f:
                history = json.load(f)
        else:
            history = {"applications": []}

        entry = {
            "date": datetime.now().isoformat()[:10],
            "profile_used": profile_id,
            "jd_keywords": transformers_context.get("must_include_keywords", []),
            "matched_skills": transformers_context.get("must_include_keywords", []),
            "seniority": transformers_context.get("seniority", ""),
            "company_type": transformers_context.get("company_type", ""),
            "font_size": font_size,
            "pages": pages
        }

        history["applications"].append(entry)

        with open(history_path, "w") as f:
            json.dump(history, f, indent=2)
    except Exception as e:
        logging.warning(f"History append failed (non-critical): {e}")
```

Do NOT send history to LLM. Do NOT show to user. Just store silently.

---

## 4. Update Frontend — Editor.tsx

Update the `/edit-resume` API call to send the new request shape:

```typescript
const response = await fetch(`${SIDECAR}/edit-resume`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jd_text: jdText,
    profile_resume: profileResume,      // profile-specific sections only
    profile_name: activeProfileName,    // e.g. "Backend Engineer"
    basics: sharedBasics,               // from shared.json
    shared_education: sharedEducation,  // from shared.json
    user_instructions: userInstructions,
    llm_config: modelConfig,
    transformers_context: transformersContext  // from Transformers.js
  })
});
```

---

## 5. Important Notes

- Never send `research_text` anywhere — it has been removed from the app
- Never say "master resume" anywhere in code or prompts — it is "profile resume"
- The static prompt must be identical across all calls for caching to work — do not modify it per-user or per-call
- Gemini cache is created once per app session and reused — GeminiCacheManager instance must be shared across requests (module-level singleton)
- History append failures must never crash the export — wrap in try/except always
- validate_output must never crash — if indices are out of range, skip silently
