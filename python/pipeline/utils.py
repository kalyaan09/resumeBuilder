"""
Shared pipeline utilities: robust JSON parsing and tenacity-wrapped LLM calls.
"""
import json
import re

from json_repair import repair_json
from tenacity import retry, wait_random_exponential, stop_after_attempt, retry_if_exception


def _is_rate_limit(exc: BaseException) -> bool:
    msg = str(exc)
    return "429" in msg or "RESOURCE_EXHAUSTED" in msg or "quota" in msg.lower()


def robust_parse(raw: str):
    """Strip markdown fences, repair, and parse JSON. Returns dict or list."""
    text = raw.strip()

    # If the LLM followed instructions to use our special tag, prioritize that block.
    tag = "[OUTPUT_ONLY_JSON]"
    if tag in text:
        parts = text.split(tag)
        if len(parts) >= 3:
            # content between first and second tag
            text = parts[1].strip()
        elif len(parts) == 2:
            # content after the first tag
            text = parts[1].strip()

    # Strip markdown fences
    text = re.sub(r"```json|```", "", text).strip()

    # If it still doesn't start with { or [, try to find them
    if not (text.startswith("{") or text.startswith("[")):
        start_idx = text.find("{")
        start_idx_bracket = text.find("[")

        if start_idx != -1 and (start_idx_bracket == -1 or start_idx < start_idx_bracket):
            text = text[start_idx:]
            end_idx = text.rfind("}")
            if end_idx != -1:
                text = text[:end_idx + 1]
        elif start_idx_bracket != -1:
            text = text[start_idx_bracket:]
            end_idx = text.rfind("]")
            if end_idx != -1:
                text = text[:end_idx + 1]

    try:
        return json.loads(repair_json(text))
    except Exception:
        # Fallback to repair_json on the original if extraction failed
        return json.loads(repair_json(raw))


# Only retries on non-rate-limit errors — llm_client already handles 429s internally.
@retry(
    retry=retry_if_exception(lambda e: not _is_rate_limit(e)),
    wait=wait_random_exponential(min=1, max=30),
    stop=stop_after_attempt(2),
)
def invoke_llm_with_retry(llm_fn, *args, **kwargs):
    return llm_fn(*args, **kwargs)
