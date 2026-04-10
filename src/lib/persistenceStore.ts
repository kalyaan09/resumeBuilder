/**
 * File-backed persistence for the resume editor.
 *
 * Files on disk (under ~/.resume-editor/):
 *   config.json        — template, role, level, sections, modelConfig, savePath
 *   master_resume.json — extracted JSON Resume schema
 *
 * Falls back to localStorage keys "re_config" and "re_resume" when running
 * outside Tauri (browser / Vite dev mode without the desktop shell).
 */

const DIR = ".resume-editor";
const CONFIG_PATH = `${DIR}/config.json`;
const RESUME_PATH = `${DIR}/master_resume.json`;

const LS_CONFIG = "re_config";
const LS_RESUME = "re_resume";

// ── Internal helpers ──────────────────────────────────────────────────────────

async function tauriAvailable(): Promise<boolean> {
  try {
    await import("@tauri-apps/plugin-fs");
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(): Promise<void> {
  const { exists, mkdir, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const ok = await exists(DIR, { baseDir: BaseDirectory.Home });
  if (!ok) {
    await mkdir(DIR, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function writeConfig(data: Record<string, unknown>): Promise<void> {
  try {
    const { writeTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    await ensureDir();
    await writeTextFile(CONFIG_PATH, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.Home,
    });
  } catch {
    localStorage.setItem(LS_CONFIG, JSON.stringify(data));
  }
}

export async function readConfig(): Promise<Record<string, unknown> | null> {
  try {
    const { readTextFile, exists, BaseDirectory } = await import(
      "@tauri-apps/plugin-fs"
    );
    const ok = await exists(CONFIG_PATH, { baseDir: BaseDirectory.Home });
    if (!ok) return null;
    const text = await readTextFile(CONFIG_PATH, { baseDir: BaseDirectory.Home });
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const raw = localStorage.getItem(LS_CONFIG);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

// ── Master resume ─────────────────────────────────────────────────────────────

export async function writeResume(data: Record<string, unknown>): Promise<void> {
  try {
    const { writeTextFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    await ensureDir();
    await writeTextFile(RESUME_PATH, JSON.stringify(data, null, 2), {
      baseDir: BaseDirectory.Home,
    });
  } catch {
    localStorage.setItem(LS_RESUME, JSON.stringify(data));
  }
}

export async function readResume(): Promise<Record<string, unknown> | null> {
  try {
    const { readTextFile, exists, BaseDirectory } = await import(
      "@tauri-apps/plugin-fs"
    );
    const ok = await exists(RESUME_PATH, { baseDir: BaseDirectory.Home });
    if (!ok) return null;
    const text = await readTextFile(RESUME_PATH, { baseDir: BaseDirectory.Home });
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const raw = localStorage.getItem(LS_RESUME);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
