/**
 * File-backed persistence for the resume editor.
 *
 * Files on disk (under ~/.resume-editor/):
 *   config.json        — template, role, level, sections, modelConfig, savePath
 *   master_resume.json — extracted JSON Resume schema
 *
 * Always writes to BOTH Tauri FS and localStorage so reads are consistent
 * regardless of which storage is available in a given session.
 */

const DIR = ".resume-editor";
const CONFIG_PATH = `${DIR}/config.json`;
const RESUME_PATH = `${DIR}/master_resume.json`;

const LS_CONFIG = "re_config";
const LS_RESUME = "re_resume";

// ── Internal helpers ──────────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  const { exists, mkdir, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const ok = await exists(DIR, { baseDir: BaseDirectory.Home });
  if (!ok) {
    await mkdir(DIR, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

async function tauriRead(path: string): Promise<string | null> {
  try {
    const { readTextFile, exists, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    const ok = await exists(path, { baseDir: BaseDirectory.Home });
    if (!ok) return null;
    return await readTextFile(path, { baseDir: BaseDirectory.Home });
  } catch {
    return null;
  }
}

async function tauriWrite(path: string, text: string): Promise<void> {
  const { writeTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  await ensureDir();
  await writeTextFile(path, text, { baseDir: BaseDirectory.Home });
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function writeConfig(data: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  // Always write to localStorage so it's always available as fallback.
  localStorage.setItem(LS_CONFIG, text);
  // Best-effort write to disk (silently ignore errors).
  try {
    await tauriWrite(CONFIG_PATH, text);
  } catch {
    // localStorage copy is the fallback — already written above.
  }
}

export async function readConfig(): Promise<Record<string, unknown> | null> {
  // Prefer disk; fall back to localStorage.
  const text = (await tauriRead(CONFIG_PATH)) ?? localStorage.getItem(LS_CONFIG);
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Master resume ─────────────────────────────────────────────────────────────

export async function writeResume(data: Record<string, unknown>): Promise<void> {
  const text = JSON.stringify(data, null, 2);
  // Always write to localStorage so it's always available as fallback.
  localStorage.setItem(LS_RESUME, text);
  // Best-effort write to disk (silently ignore errors).
  try {
    await tauriWrite(RESUME_PATH, text);
  } catch {
    // localStorage copy is the fallback — already written above.
  }
}

export async function readResume(): Promise<Record<string, unknown> | null> {
  // Prefer disk; fall back to localStorage.
  const text = (await tauriRead(RESUME_PATH)) ?? localStorage.getItem(LS_RESUME);
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
