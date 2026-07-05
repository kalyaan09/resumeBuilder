import hashlib
import logging
import re
import threading
import time
from typing import Optional

log = logging.getLogger("resume")

# Covers rate limits (long backoff) and transient network/SDK failures (short backoff).
_GEMINI_MAX_ATTEMPTS = 10

# Per-request timeout for provider HTTP calls (seconds). One hung TCP connection
# must not stall a tailoring job forever.
_REQUEST_TIMEOUT_S = 120.0

# ── Per-thread call deadline ──────────────────────────────────────────────────
# A tailoring job sets a wall-clock deadline for its thread; every LLM call and
# retry sleep checks it, so a rate-limit spiral errors out quickly instead of
# spinning past the frontend's poll timeout.
_deadline_local = threading.local()


class DeadlineExceeded(TimeoutError):
    pass


def set_call_deadline(seconds: Optional[float]) -> None:
    """Set (or clear with None) the LLM call deadline for the current thread."""
    _deadline_local.at = (time.monotonic() + seconds) if seconds else None


def _remaining_budget() -> Optional[float]:
    at = getattr(_deadline_local, "at", None)
    return None if at is None else at - time.monotonic()


def _check_deadline() -> None:
    remaining = _remaining_budget()
    if remaining is not None and remaining <= 0:
        raise DeadlineExceeded(
            "Tailoring took too long — the model provider is rate-limiting or responding slowly. "
            "Wait a minute and try again, or switch to a faster model in Settings → AI Model."
        )


def _is_gemini_resource_exhausted(exc: BaseException) -> bool:
    msg = str(exc)
    return "429" in msg or "RESOURCE_EXHAUSTED" in msg or "quota" in msg.lower()


def _is_gemini_transient_error(exc: BaseException) -> bool:
    """Fetch-layer and connection errors that often succeed on retry (incl. WebView/proxy flakiness)."""
    msg = str(exc).lower()
    needles = (
        "load failed",
        "fetch failed",
        "connection reset",
        "connection aborted",
        "remote end closed",
        "timed out",
        "timeout",
        "temporarily unavailable",
        "econnreset",
        "econnrefused",
        "broken pipe",
        "503",
        "502",
    )
    return any(n in msg for n in needles)


def _is_gemini_retryable_server_error(exc: BaseException) -> bool:
    """Google occasionally returns 500 INTERNAL on busy models (e.g. Gemma); retries often succeed."""
    msg = str(exc)
    return "500" in msg and ("INTERNAL" in msg or "internal error" in msg.lower())


def _gemini_retry_sleep_seconds(exc: BaseException, attempt: int) -> float:
    """Parse RetryInfo from Google error text, else exponential backoff (capped)."""
    msg = str(exc)
    m = re.search(r"retryDelay['\"]:\s*['\"](\d+(?:\.\d+)?)s['\"]", msg)
    if m:
        return min(float(m.group(1)) + 0.75, 120.0)
    m2 = re.search(r"retry in ([\d.]+)s", msg, re.I)
    if m2:
        return min(float(m2.group(1)) + 0.75, 120.0)
    return min(8.0 * (1.4**attempt), 90.0)


def _prompt_fingerprint(static_prompt: str) -> str:
    return hashlib.sha256(static_prompt.encode("utf-8")).hexdigest()


class GeminiCacheManager:
    def __init__(self):
        self._cache_name = None
        self._cache_created_at = None
        self._cache_ttl = 3600  # 1 hour
        self._cache_model: Optional[str] = None
        self._cache_prompt_fp: Optional[str] = None

    def get_or_create_cache(self, static_prompt: str, model: str, api_key: str) -> str:
        fp = _prompt_fingerprint(static_prompt)
        if (
            self._cache_name
            and self._cache_created_at
            and self._cache_model == model
            and self._cache_prompt_fp == fp
            and time.time() - self._cache_created_at < self._cache_ttl - 60
        ):
            return self._cache_name

        from google import genai as new_genai
        from google.genai import types

        client = _genai_client(api_key)
        cache = client.caches.create(
            model=model,
            config=types.CreateCachedContentConfig(
                system_instruction=static_prompt,
                ttl=f"{self._cache_ttl}s",
            ),
        )
        self._cache_name = cache.name
        self._cache_created_at = time.time()
        self._cache_model = model
        self._cache_prompt_fp = fp
        return self._cache_name


# Module-level singleton — shared across all requests (required for Gemini cache reuse)
_gemini_cache_manager = GeminiCacheManager()


def _genai_client(api_key: Optional[str]):
    """google-genai client with a per-request timeout (ms)."""
    from google import genai as new_genai
    from google.genai import types

    return new_genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=int(_REQUEST_TIMEOUT_S * 1000)),
    )


def _genai_response_text(response) -> str:
    """Best-effort text extraction (blocked / empty .text on some models)."""
    t = getattr(response, "text", None)
    if t:
        return t
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return ""
    chunks = []
    for cand in candidates:
        parts = getattr(getattr(cand, "content", None), "parts", None) or []
        for p in parts:
            txt = getattr(p, "text", None)
            if txt:
                chunks.append(txt)
    return "".join(chunks)


class LLMClient:
    def __init__(self, provider: str, model: str, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.base_url = base_url
        self.cache_manager = _gemini_cache_manager

    @classmethod
    def from_config(cls, config: dict) -> "LLMClient":
        provider = config.get("provider", "")
        model = config.get("model", "")
        api_key = config.get("api_key", "")
        base_url = config.get("base_url", "")
        if provider not in ("ollama",) and not api_key:
            raise ValueError(f"No API key configured for provider '{provider}'")
        return cls(provider=provider, model=model, api_key=api_key, base_url=base_url)

    def complete(self, static_prompt: str, dynamic_prompt: str, max_tokens: int = 4096) -> str:
        _check_deadline()
        if self.provider == "anthropic":
            return self._complete_anthropic(static_prompt, dynamic_prompt, max_tokens)
        elif self.provider in ("openai", "groq", "openrouter"):
            return self._complete_openai(static_prompt, dynamic_prompt, max_tokens)
        elif self.provider == "gemini":
            return self._complete_gemini(static_prompt, dynamic_prompt, max_tokens)
        elif self.provider == "ollama":
            return self._complete_ollama(static_prompt, dynamic_prompt, max_tokens)
        else:
            # Fallback for any unknown provider: treat as OpenAI-compatible
            return self._complete_openai(static_prompt, dynamic_prompt, max_tokens)

    def _complete_anthropic(self, static_prompt: str, dynamic_prompt: str, max_tokens: int) -> str:
        import anthropic

        client = anthropic.Anthropic(api_key=self.api_key, timeout=_REQUEST_TIMEOUT_S)

        def attempt_once():
            response = client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=[
                    {
                        "type": "text",
                        "text": static_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": dynamic_prompt}],
            )
            return response.content[0].text

        return self._gemini_retry_loop(attempt_once)

    def _complete_openai(self, static_prompt: str, dynamic_prompt: str, max_tokens: int) -> str:
        from openai import OpenAI

        kwargs = {"api_key": self.api_key or "openai", "timeout": _REQUEST_TIMEOUT_S}

        if self.provider == "openrouter":
            kwargs["base_url"] = "https://openrouter.ai/api/v1"
        elif self.provider == "groq":
            kwargs["base_url"] = "https://api.groq.com/openai/v1"
        # openai uses default base_url

        client = OpenAI(**kwargs)

        def attempt_once():
            response = client.chat.completions.create(
                model=self.model,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": static_prompt},
                    {"role": "user", "content": dynamic_prompt},
                ],
            )
            return response.choices[0].message.content or ""

        return self._gemini_retry_loop(attempt_once)

    def _gemini_model_id(self) -> str:
        """Pass through user config; Google accepts ids like gemini-2.5-flash or models/gemini-2.5-flash."""
        return (self.model or "").strip()

    def _gemini_skip_cached_content(self) -> bool:
        """
        Gemma and several open-weight endpoints often fail or error on CachedContent + from_cached_content
        (Load failed / 400). Use the unified generate_content path instead.
        """
        m = (self.model or "").lower()
        if "gemma" in m:
            return True
        return False

    def _gemini_merge_prompt_for_open_models(self) -> bool:
        """Some Gemma releases regress on very large system_instruction; merge into one user turn."""
        return "gemma" in (self.model or "").lower()

    def _gemini_merged_user_turn(self, static_prompt: str, dynamic_prompt: str) -> str:
        return (
            "SYSTEM INSTRUCTIONS (follow these exactly):\n\n"
            f"{static_prompt}\n\n"
            "---\n\n"
            "USER REQUEST:\n\n"
            f"{dynamic_prompt}"
        )

    def _gemini_retry_loop(self, attempt_once):
        """Shared backoff for quota, network blips, and transient 500s from Google."""
        last_err: Optional[BaseException] = None

        def sleep_within_budget(sleep_s: float) -> None:
            remaining = _remaining_budget()
            if remaining is not None and sleep_s >= remaining:
                _check_deadline()  # raises if already expired
                raise DeadlineExceeded(
                    "Tailoring stopped early — the model provider keeps rate-limiting and the "
                    "remaining time budget is too small for another retry. Wait a minute and try again."
                )
            time.sleep(sleep_s)

        for attempt in range(_GEMINI_MAX_ATTEMPTS):
            try:
                return attempt_once()
            except DeadlineExceeded:
                raise
            except Exception as e:
                last_err = e
                if attempt >= _GEMINI_MAX_ATTEMPTS - 1:
                    raise
                if _is_gemini_resource_exhausted(e):
                    sleep_s = _gemini_retry_sleep_seconds(e, attempt)
                    log.warning(
                        "[gemini] rate limited (attempt %d/%d), retry in %.1fs",
                        attempt + 1,
                        _GEMINI_MAX_ATTEMPTS,
                        sleep_s,
                    )
                    sleep_within_budget(sleep_s)
                    continue
                if _is_gemini_transient_error(e):
                    sleep_s = min(3.0 * (1.6**attempt), 60.0)
                    log.warning(
                        "[gemini] transient error (attempt %d/%d): %s — retry in %.1fs",
                        attempt + 1,
                        _GEMINI_MAX_ATTEMPTS,
                        e,
                        sleep_s,
                    )
                    sleep_within_budget(sleep_s)
                    continue
                if _is_gemini_retryable_server_error(e):
                    sleep_s = min(1.5 + 2.5 * attempt, 45.0)
                    log.warning(
                        "[gemini] server error (attempt %d/%d): %s — retry in %.1fs",
                        attempt + 1,
                        _GEMINI_MAX_ATTEMPTS,
                        e,
                        sleep_s,
                    )
                    sleep_within_budget(sleep_s)
                    continue
                raise
        assert last_err is not None
        raise last_err

    def _complete_gemini_direct_new_sdk_gemma(self, static_prompt: str, dynamic_prompt: str, max_tokens: int) -> str:
        """Gemma via `google.genai` when the legacy `google-generativeai` package is not installed."""
        from google import genai as new_genai
        from google.genai import types

        client = _genai_client(self.api_key)
        model_id = self._gemini_model_id()
        merged = self._gemini_merged_user_turn(static_prompt, dynamic_prompt)
        cfg_kw: dict = {"max_output_tokens": max_tokens}
        afc_cls = getattr(types, "AutomaticFunctionCallingConfig", None)
        if afc_cls is not None:
            cfg_kw["automatic_function_calling"] = afc_cls(disable=True, maximum_remote_calls=None)

        def attempt_once():
            response = client.models.generate_content(
                model=model_id,
                contents=merged,
                config=types.GenerateContentConfig(**cfg_kw),
            )
            text = _genai_response_text(response)
            if not (text and text.strip()):
                raise RuntimeError("Empty or blocked response from Gemma (no text in candidates).")
            return text

        return self._gemini_retry_loop(attempt_once)

    def _complete_gemini_direct_legacy_gemma(self, static_prompt: str, dynamic_prompt: str, max_tokens: int) -> str:
        """
        AI Studio's Python samples use google.generativeai.GenerativeModel; the newer `google.genai`
        client often triggers 500 INTERNAL on Gemma with the same key/model even when Studio works.
        """
        try:
            import google.generativeai as genai
        except ImportError:
            log.warning(
                "[gemini] google-generativeai not installed; using google.genai for Gemma. "
                "Install with: pip install google-generativeai (matches AI Studio snippets)."
            )
            return self._complete_gemini_direct_new_sdk_gemma(static_prompt, dynamic_prompt, max_tokens)

        log.info("[gemini] Gemma: google.generativeai path (aligned with AI Studio Python snippets)")
        genai.configure(api_key=self.api_key)
        model_id = self._gemini_model_id()
        merged = self._gemini_merged_user_turn(static_prompt, dynamic_prompt)
        model = genai.GenerativeModel(model_id)

        def attempt_once():
            response = model.generate_content(
                merged,
                generation_config=genai.GenerationConfig(max_output_tokens=max_tokens),
            )
            text = _genai_response_text(response)
            if not (text and text.strip()):
                raise RuntimeError("Empty or blocked response from Gemma (no text in candidates).")
            return text

        return self._gemini_retry_loop(attempt_once)

    def _complete_gemini_direct_new_sdk(self, static_prompt: str, dynamic_prompt: str, max_tokens: int) -> str:
        """Gemini models via google-genai (prefix cache friendly, AFC-capable)."""
        from google import genai as new_genai
        from google.genai import types

        client = _genai_client(self.api_key)
        model_id = self._gemini_model_id()

        def attempt_once():
            response = client.models.generate_content(
                model=model_id,
                contents=dynamic_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=static_prompt,
                    max_output_tokens=max_tokens,
                ),
            )
            text = _genai_response_text(response)
            if not (text and text.strip()):
                raise RuntimeError("Empty or blocked response from Gemini (no text in candidates).")
            return text

        return self._gemini_retry_loop(attempt_once)

    def _complete_gemini_direct(self, static_prompt: str, dynamic_prompt: str, max_tokens: int) -> str:
        if self._gemini_merge_prompt_for_open_models():
            return self._complete_gemini_direct_legacy_gemma(static_prompt, dynamic_prompt, max_tokens)
        return self._complete_gemini_direct_new_sdk(static_prompt, dynamic_prompt, max_tokens)

    def _complete_gemini(self, static_prompt: str, dynamic_prompt: str, max_tokens: int) -> str:
        if self._gemini_skip_cached_content():
            return self._complete_gemini_direct(static_prompt, dynamic_prompt, max_tokens)

        try:
            cache_name = self.cache_manager.get_or_create_cache(static_prompt, self.model, self.api_key)
            from google import genai as new_genai
            from google.genai import types

            client = _genai_client(self.api_key)
            response = client.models.generate_content(
                model=self._gemini_model_id(),
                contents=dynamic_prompt,
                config=types.GenerateContentConfig(
                    cached_content=cache_name,
                    max_output_tokens=max_tokens,
                ),
            )
            text = _genai_response_text(response)
            if text.strip():
                return text
            raise RuntimeError("Empty text from cached Gemini model")
        except Exception as e:
            log.warning("[gemini] cached path failed (%s), using direct generate_content", e)
            return self._complete_gemini_direct(static_prompt, dynamic_prompt, max_tokens)

    def _complete_ollama(self, static_prompt: str, dynamic_prompt: str, max_tokens: int) -> str:
        import requests

        base_url = self.base_url or "http://localhost:11434"
        # Strip /v1 suffix if present — Ollama's native API is at /api/chat
        base_url = base_url.rstrip("/").removesuffix("/v1")

        response = requests.post(
            f"{base_url}/api/chat",
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": static_prompt},
                    {"role": "user", "content": dynamic_prompt},
                ],
                "stream": False,
            },
            timeout=120,
        )
        response.raise_for_status()
        return response.json()["message"]["content"]
