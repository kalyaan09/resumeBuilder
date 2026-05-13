/**
 * Secure key storage backed by @tauri-apps/plugin-store (encrypted on disk).
 * Falls back to a separate localStorage entry when running outside Tauri (browser dev mode).
 *
 * Keys are stored per-provider: { gemini: "AIza...", anthropic: "sk-ant-..." }
 * Non-sensitive config (provider, model, base_url) stays in the main localStorage config.
 */

const STORE_FILE = "keys.dat"; // encrypted file managed by Tauri
const LS_FALLBACK_KEY = "resume_editor_keys"; // plain browser fallback

export async function getApiKey(provider: string): Promise<string> {
  if (!provider) return "";
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    const storeKey = await store.get<string>(provider);
    if (storeKey) return storeKey;
    // Tauri Store available but key absent — fall back to localStorage copy.
    const keys = JSON.parse(localStorage.getItem(LS_FALLBACK_KEY) || "{}");
    return keys[provider] || "";
  } catch {
    // Not in Tauri context: use isolated localStorage entry.
    const keys = JSON.parse(localStorage.getItem(LS_FALLBACK_KEY) || "{}");
    return keys[provider] || "";
  }
}

export async function setApiKey(provider: string, key: string): Promise<void> {
  if (!provider) return;
  // Always write to localStorage first so getApiKey can fall back to it.
  const keys = JSON.parse(localStorage.getItem(LS_FALLBACK_KEY) || "{}");
  keys[provider] = key;
  localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(keys));
  // Also persist to Tauri Store (encrypted, preferred in production).
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    const store = await Store.load(STORE_FILE);
    await store.set(provider, key);
    await store.save();
  } catch {
    // Not in Tauri context — localStorage fallback already written above.
  }
}
