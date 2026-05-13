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

  // Auth / invalid key
  if (
    lower.includes("invalid x-api-key") ||
    lower.includes("authentication_error") ||
    lower.includes("api_key_invalid") ||
    lower.includes("api key not valid") ||
    code === 401
  ) {
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

  // WKWebView / Safari often surfaces this when a long localhost request stalls or the shell drops the connection
  if (
    lower.includes("load failed") ||
    lower.includes("loadfailed") ||
    (lower.includes("typeerror") && lower.includes("load")) ||
    lower.includes("the network connection was lost") ||
    lower.includes("network connection was lost")
  ) {
    return {
      title: "Connection dropped while tailoring",
      message:
        "Tailoring can take many minutes on slow models (for example Gemma). The browser lost the link to the local preview service before a response arrived—often a timeout, sleep/wake, or a busy CPU. Keep this window in the foreground, click Retry, or restart the preview service. If Gemini Flash hits a daily free limit, Gemma is still an option; it is just slower.",
      code,
      raw: text,
    };
  }

  // Invalid model / not found (common after provider renames)
  if (
    code === 404 ||
    (lower.includes("not found") && (lower.includes("model") || lower.includes("models/"))) ||
    lower.includes("was not found")
  ) {
    return {
      title: "Model or resource not found",
      message:
        "The provider could not find this model id. Open Settings → AI Model and pick another model string, or check Google AI Studio / your provider docs.",
      code: code ?? 404,
      raw: text,
    };
  }

  // Permission / billing
  if (code === 403 || lower.includes("permission denied") || lower.includes("consumer_suspended")) {
    return {
      title: "Access denied",
      message: "Your account or key may not have access to this model. Check billing, API enablement, and project restrictions.",
      code: code ?? 403,
      raw: text,
    };
  }

  // Rate limit
  if (code === 429 || lower.includes("rate limit") || lower.includes("resource exhausted")) {
    return {
      title: "Rate limited",
      message:
        "Too many requests or the daily free-tier cap for this model (common on gemini-2.5-flash). Limits reset on Google’s schedule—wait, enable billing in Google AI Studio for higher quotas, or use another model (for example Gemma—expect slower runs and occasional retries).",
      code: code ?? 429,
      raw: text,
    };
  }

  // Bad request (often bad model id or payload)
  if (code === 400 || lower.includes("invalidargument") || lower.includes("invalid argument")) {
    return {
      title: "Invalid request",
      message: truncateForUi(text, 420) || "The provider rejected the request. Check model name and API key.",
      code: code ?? 400,
      raw: text,
    };
  }

  // Generic but show real provider text (not a vague “try again” only)
  const trimmed = truncateForUi(text, 500);
  return {
    title: "Provider error",
    message: trimmed || "No details were returned. Check Settings → AI Model and try again.",
    code,
    raw: text,
  };
}

function truncateForUi(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

