from typing import Optional


class LLMClient:
    def __init__(self, provider: str, model: str, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.base_url = base_url

    @classmethod
    def from_config(cls, config: dict) -> "LLMClient":
        provider = config.get("provider", "")
        model = config.get("model", "")
        api_key = config.get("api_key", "")
        base_url = config.get("base_url", "")
        return cls(provider=provider, model=model, api_key=api_key, base_url=base_url)

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        if self.provider == "anthropic":
            return self._complete_anthropic(system_prompt, user_prompt)
        elif self.provider == "gemini":
            return self._complete_gemini(system_prompt, user_prompt)
        else:
            # Ollama, OpenRouter, Groq, OpenAI — all OpenAI-compatible
            return self._complete_openai_compat(system_prompt, user_prompt)

    def _complete_openai_compat(self, system_prompt: str, user_prompt: str) -> str:
        from openai import OpenAI

        kwargs = {"api_key": self.api_key or "ollama"}

        if self.provider == "ollama":
            kwargs["base_url"] = self.base_url or "http://localhost:11434/v1"
            kwargs["api_key"] = "ollama"
        elif self.provider == "openrouter":
            kwargs["base_url"] = "https://openrouter.ai/api/v1"
        elif self.provider == "groq":
            kwargs["base_url"] = "https://api.groq.com/openai/v1"
        # openai uses default base_url

        client = OpenAI(**kwargs)
        response = client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
        )
        return response.choices[0].message.content or ""

    def _complete_anthropic(self, system_prompt: str, user_prompt: str) -> str:
        import anthropic

        client = anthropic.Anthropic(api_key=self.api_key)
        message = client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return message.content[0].text

    def _complete_gemini(self, system_prompt: str, user_prompt: str) -> str:
        import google.generativeai as genai

        genai.configure(api_key=self.api_key)
        model = genai.GenerativeModel(
            model_name=self.model,
            system_instruction=system_prompt,
        )
        response = model.generate_content(user_prompt)
        return response.text
