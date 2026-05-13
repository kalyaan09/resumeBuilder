"""
Map provider SDK / HTTP exceptions to short, actionable messages for the UI.
Never include API keys or long stack traces in returned strings.
"""

from __future__ import annotations

import re
from typing import Optional


def redact_secrets(text: str) -> str:
    if not text:
        return text
    t = text
    t = re.sub(r"sk-(?:ant|or|proj)-[A-Za-z0-9_-]{8,}", "sk-…", t)
    t = re.sub(r"AIza[0-9A-Za-z_-]{15,}", "AIza…", t)
    t = re.sub(r"gsk_[A-Za-z0-9_-]{8,}", "gsk_…", t)
    t = re.sub(r"Bearer\s+[A-Za-z0-9._-]{10,}", "Bearer …", t, flags=re.I)
    return t


def _prefix(provider: Optional[str]) -> str:
    if not provider:
        return ""
    labels = {
        "gemini": "Google Gemini",
        "anthropic": "Anthropic",
        "openai": "OpenAI",
        "groq": "Groq",
        "openrouter": "OpenRouter",
        "ollama": "Ollama",
    }
    return f"{labels.get(provider, provider)}: "


def format_api_error(exc: BaseException, *, provider: Optional[str] = None) -> str:
    """
    One or two sentences the app can show in Settings, toasts, or HTTP detail.
    """
    pre = _prefix(provider)
    raw = redact_secrets(str(exc).strip()) if exc else "Unknown error"
    low = raw.lower()
    name = type(exc).__name__

    # --- Google API Core (used by google-generativeai / Vertex-style clients) ---
    try:
        from google.api_core import exceptions as gexc

        if isinstance(exc, gexc.InvalidArgument):
            if "api key" in low or "api_key" in low:
                return pre + "The API key was rejected or is not allowed for this model. Check Google AI Studio."
            return pre + f"Invalid request ({name}): {raw}"
        if isinstance(exc, gexc.NotFound):
            return pre + (
                f"Model or resource not found: {raw}. "
                "Confirm the model id in Settings (try the models/… form if the short id fails)."
            )
        if isinstance(exc, gexc.PermissionDenied):
            return pre + f"Permission denied: {raw}. Check billing, API restrictions, or project access."
        if isinstance(exc, gexc.ResourceExhausted):
            return pre + f"Quota or rate limit: {raw}. Wait a minute and retry, or check usage limits."
        if isinstance(exc, gexc.Unauthenticated):
            return pre + f"Authentication failed: {raw}. Replace your API key in Settings."
        if isinstance(exc, gexc.DeadlineExceeded):
            return pre + "The request timed out. Try again with a shorter job or a faster model."
        if isinstance(exc, gexc.ServiceUnavailable):
            return pre + f"The AI service is temporarily unavailable: {raw}. Retry shortly."
        if isinstance(exc, gexc.GoogleAPIError):
            return pre + f"Google API error ({name}): {raw}"
    except ImportError:
        pass

    # --- OpenAI-compatible SDKs ---
    try:
        from openai import (
            APIError,
            APIConnectionError,
            APITimeoutError,
            AuthenticationError,
            BadRequestError,
            NotFoundError,
            PermissionDeniedError,
            RateLimitError,
        )

        if isinstance(exc, AuthenticationError):
            return pre + f"API key rejected: {raw}"
        if isinstance(exc, PermissionDeniedError):
            return pre + f"Access denied: {raw}"
        if isinstance(exc, NotFoundError):
            return pre + f"Model not found: {raw}. Update the model name in Settings."
        if isinstance(exc, BadRequestError):
            return pre + f"Bad request: {raw}"
        if isinstance(exc, RateLimitError):
            return pre + f"Rate limited: {raw}. Wait and retry."
        if isinstance(exc, APITimeoutError):
            return pre + "Request timed out. Retry or use a lighter model."
        if isinstance(exc, APIConnectionError):
            return pre + f"Could not reach the API: {raw}"
        if isinstance(exc, APIError):
            return pre + f"API error: {raw}"
    except ImportError:
        pass

    # --- Anthropic ---
    try:
        import anthropic

        if isinstance(exc, anthropic.AuthenticationError):
            return pre + f"API key invalid: {raw}"
        if isinstance(exc, anthropic.RateLimitError):
            return pre + f"Rate limited: {raw}"
        if isinstance(exc, anthropic.BadRequestError):
            return pre + f"Bad request: {raw}"
        if isinstance(exc, anthropic.NotFoundError):
            return pre + f"Not found: {raw}"
        if isinstance(exc, anthropic.APIError):
            return pre + f"Anthropic API error: {raw}"
    except ImportError:
        pass

    # --- requests (Ollama, etc.) ---
    resp = getattr(exc, "response", None)
    if resp is not None:
        try:
            status = getattr(resp, "status_code", None)
            snippet = ""
            try:
                snippet = redact_secrets((resp.text or "")[:280].strip())
            except Exception:
                pass
            if status == 401:
                return pre + "Unauthorized (401). Check local service or credentials."
            if status == 404:
                return pre + f"Not found (404). {snippet or 'Wrong URL or model name.'}"
            if status == 429:
                return pre + f"Too many requests (429). {snippet}"
            if status and status >= 500:
                return pre + f"Server error ({status}). {snippet or 'Retry later.'}"
            if snippet:
                return pre + f"HTTP {status}: {snippet}"
        except Exception:
            pass

    # --- Heuristic fallbacks on message text ---
    if "load failed" in low or "failed to load" in low:
        return pre + (
            f"{raw} "
            "If you use Gemini/Gemma, pick another model id, confirm the key in Google AI Studio, "
            "or try again after a minute."
        )
    if "invalid" in low and ("api" in low and "key" in low):
        return pre + "The API key was rejected. Generate a new key and update Settings."
    if "location" in low and "not supported" in low:
        return pre + "This model or Google AI feature is not available in your region."
    if "exceeded" in low and ("quota" in low or "limit" in low):
        return pre + f"Quota or limit exceeded: {raw}"

    if not raw:
        return pre + f"{name} (no message from provider)"
    return pre + raw


def http_status_for_error(exc: BaseException) -> Optional[int]:
    """Best-effort HTTP status for mapping to FastAPI responses."""
    resp = getattr(exc, "response", None)
    if resp is not None:
        code = getattr(resp, "status_code", None)
        if isinstance(code, int):
            return code
    try:
        from google.api_core import exceptions as gexc

        if isinstance(exc, gexc.InvalidArgument):
            return 400
        if isinstance(exc, gexc.Unauthenticated):
            return 401
        if isinstance(exc, gexc.PermissionDenied):
            return 403
        if isinstance(exc, gexc.NotFound):
            return 404
        if isinstance(exc, gexc.ResourceExhausted):
            return 429
        if isinstance(exc, gexc.ServiceUnavailable):
            return 503
    except ImportError:
        pass
    return None
