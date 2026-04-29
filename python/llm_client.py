import time
from typing import Optional


class GeminiCacheManager:
    def __init__(self):
        self._cache_name = None
        self._cache_created_at = None
        self._cache_ttl = 3600  # 1 hour

    def get_or_create_cache(self, static_prompt: str, model: str, api_key: str) -> str:
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


# Module-level singleton — shared across all requests (required for Gemini cache reuse)
_gemini_cache_manager = GeminiCacheManager()


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
        return cls(provider=provider, model=model, api_key=api_key, base_url=base_url)

    def complete(self, static_prompt: str, dynamic_prompt: str, max_tokens: int = 4096) -> str:
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

        client = anthropic.Anthropic(api_key=self.api_key)
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

    def _complete_openai(self, static_prompt: str, dynamic_prompt: str, max_tokens: int) -> str:
        from openai import OpenAI

        kwargs = {"api_key": self.api_key or "openai"}

        if self.provider == "openrouter":
            kwargs["base_url"] = "https://openrouter.ai/api/v1"
        elif self.provider == "groq":
            kwargs["base_url"] = "https://api.groq.com/openai/v1"
        # openai uses default base_url

        client = OpenAI(**kwargs)
        response = client.chat.completions.create(
            model=self.model,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": static_prompt},
                {"role": "user", "content": dynamic_prompt},
            ],
        )
        return response.choices[0].message.content or ""

    def _complete_gemini(self, static_prompt: str, dynamic_prompt: str, max_tokens: int) -> str:
        try:
            cache_name = self.cache_manager.get_or_create_cache(
                static_prompt, self.model, self.api_key
            )
            import google.generativeai as genai
            model = genai.GenerativeModel.from_cached_content(cached_content=cache_name)
            response = model.generate_content(dynamic_prompt)
            return response.text
        except Exception:
            # Fall back to uncached if caching fails (e.g. prompt too short for caching)
            from google import genai as new_genai
            from google.genai import types

            client = new_genai.Client(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model,
                contents=dynamic_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=static_prompt,
                    max_output_tokens=max_tokens,
                ),
            )
            return response.text

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
