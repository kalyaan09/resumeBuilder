/** Parse error payload from an already-read response body (single read of Response). */
export function parseErrorDetailBody(text: string, res: Response): string {
  const t = text.trim();
  if (!t) return res.statusText || `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(t) as Record<string, unknown>;
    const d = parsed.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((item: unknown) => {
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg: unknown }).msg);
          }
          return JSON.stringify(item);
        })
        .join(" ");
    }
    if (d && typeof d === "object" && "message" in d) {
      return String((d as { message: unknown }).message);
    }
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    /* not JSON */
  }
  return t.length > 800 ? `${t.slice(0, 800)}…` : t;
}

/**
 * Read a useful error string from a failed fetch Response (FastAPI, etc.).
 * Consumes the body once.
 */
export async function readErrorDetailFromResponse(res: Response): Promise<string> {
  const text = await res.text();
  return parseErrorDetailBody(text, res);
}
