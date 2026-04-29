export type FriendlyError = {
  title: string;
  message: string;
  code?: number;
  raw: string;
};

function extractFirstNumber(s: string): number | undefined {
  const m = s.match(/\b(\d{3})\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

export function formatAiError(raw: string): FriendlyError {
  const text = String(raw || "");
  const lower = text.toLowerCase();
  const code = extractFirstNumber(text);

  // Auth / invalid key (Anthropic-style error shown by user)
  if (lower.includes("invalid x-api-key") || lower.includes("authentication_error") || code === 401) {
    return {
      title: "API key not working",
      message: "Your AI provider API key looks invalid. Go to Settings → AI Model and update your key, then try Review again.",
      code: 401,
      raw: text,
    };
  }

  // Busy / high demand (Gemini-style 503 UNAVAILABLE)
  if (
    code === 503 ||
    lower.includes("unavailable") ||
    lower.includes("high demand") ||
    lower.includes("spikes in demand")
  ) {
    return {
      title: "AI service is busy",
      message: "This model is experiencing high demand right now. Please try again in a minute.",
      code: 503,
      raw: text,
    };
  }

  // Network / sidecar unreachable
  if (lower.includes("failed to fetch") || lower.includes("econnrefused") || lower.includes("could not reach")) {
    return {
      title: "Couldn’t reach the preview service",
      message: "The local preview service isn’t reachable. Try restarting the app (and the preview service) and try again.",
      code,
      raw: text,
    };
  }

  return {
    title: "Something went wrong",
    message: "Please try again. If it keeps happening, open Details and share the error.",
    code,
    raw: text,
  };
}

